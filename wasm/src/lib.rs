#![cfg_attr(all(target_arch = "wasm32", not(test)), no_std)]

const BUFFER_SIZE: usize = 65_536;
#[repr(align(2))]
struct Buffer([u8; BUFFER_SIZE]);
static mut BUFFER: Buffer = Buffer([0; BUFFER_SIZE]);
static mut JSON_STATE: u32 = 0;

const fn tables() -> [[u32; 256]; 8] {
    let mut table = [[0; 256]; 8];
    let mut index = 0;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 != 0 {
                (value >> 1) ^ 0xedb88320
            } else {
                value >> 1
            };
            bit += 1;
        }
        table[0][index] = value;
        index += 1;
    }
    index = 0;
    while index < 256 {
        let mut value = table[0][index];
        let mut slice = 1;
        while slice < 8 {
            value = (value >> 8) ^ table[0][(value & 255) as usize];
            table[slice][index] = value;
            slice += 1;
        }
        index += 1;
    }
    table
}

static TABLES: [[u32; 256]; 8] = tables();

fn checksum(data: &[u8], previous: u32) -> u32 {
    let mut crc = !previous;
    let mut chunks = data.chunks_exact(8);
    for chunk in &mut chunks {
        let first = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) ^ crc;
        crc = TABLES[7][(first & 255) as usize]
            ^ TABLES[6][((first >> 8) & 255) as usize]
            ^ TABLES[5][((first >> 16) & 255) as usize]
            ^ TABLES[4][(first >> 24) as usize]
            ^ TABLES[3][chunk[4] as usize]
            ^ TABLES[2][chunk[5] as usize]
            ^ TABLES[1][chunk[6] as usize]
            ^ TABLES[0][chunk[7] as usize];
    }
    for byte in chunks.remainder() {
        crc = (crc >> 8) ^ TABLES[0][((crc ^ *byte as u32) & 255) as usize];
    }
    !crc
}

#[no_mangle]
pub extern "C" fn crc_buffer() -> *mut u8 {
    unsafe { core::ptr::addr_of_mut!(BUFFER.0).cast::<u8>() }
}

#[no_mangle]
pub extern "C" fn crc32(length: usize, previous: u32) -> u32 {
    assert!(length <= BUFFER_SIZE);
    // The caller fills the buffer synchronously before each call; no threads share it.
    checksum(unsafe { &BUFFER.0[..length] }, previous)
}

fn hash_json(codes: impl Iterator<Item = u16>, mut hash: u32, mut state: u32) -> (u32, u32) {
    for code in codes {
        if state & 1 != 0 {
            if state & 2 != 0 {
                state &= !2;
            } else if code == 92 {
                state |= 2;
            } else if code == 34 {
                state = 0;
            }
        } else if code == 34 {
            state = 1;
        } else if matches!(code, 32 | 9 | 10 | 13) {
            continue;
        }
        hash = (hash ^ code as u32).wrapping_mul(0x01000193);
    }
    (hash, state)
}

#[no_mangle]
pub extern "C" fn json_hash(length: usize, previous: u32, state: u32) -> u32 {
    assert!(length <= BUFFER_SIZE / 2);
    let bytes = unsafe { &BUFFER.0[..length * 2] };
    let (hash, next_state) = hash_json(
        bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]])),
        previous,
        state,
    );
    unsafe { JSON_STATE = next_state };
    hash
}

#[no_mangle]
pub extern "C" fn json_hash_state() -> u32 {
    unsafe { JSON_STATE }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests {
    use super::{checksum, hash_json};

    #[test]
    fn standard_vectors_and_incremental_input() {
        assert_eq!(checksum(b"", 0), 0);
        assert_eq!(checksum(b"123456789", 0), 0xcbf43926);
        assert_eq!(checksum(b"56789", checksum(b"1234", 0)), 0xcbf43926);
        assert_eq!(checksum(&[0; 32], 0), 0x190a55ad);
    }

    #[test]
    fn json_hash_preserves_string_whitespace_and_utf16() {
        let input = "{\n  \"a\": \"x y 🚀\\\"\\\\z\",\n  \"b\": 1\n}";
        let compact = "{\"a\":\"x y 🚀\\\"\\\\z\",\"b\":1}";
        let expected = compact.encode_utf16().fold(0x811c9dc5u32, |hash, code| {
            (hash ^ code as u32).wrapping_mul(0x01000193)
        });
        assert_eq!(
            hash_json(input.encode_utf16(), 0x811c9dc5, 0),
            (expected, 0)
        );
        let codes: Vec<_> = input.encode_utf16().collect();
        for split in 0..=codes.len() {
            let (hash, state) = hash_json(codes[..split].iter().copied(), 0x811c9dc5, 0);
            assert_eq!(
                hash_json(codes[split..].iter().copied(), hash, state),
                (expected, 0)
            );
        }
    }
}
