# FIGM delta format

`FIGM/DELTA/1` is a change payload over a previously received FIGM handoff. It
is deliberately separate from the full [`FIGM/1` grammar](./FIGM-1.md).

```text
FIGM/DELTA/1
{
  "baseline": "snapshot:...",
  "current": "snapshot:...",
  "scope": {"document": "Checkout", "page": "Mobile", "selection": ["12:4"]},
  "changes": {
    "added": [{"parentId": "12:4", "index": 2, "id": "12:8", "node": {"...": "full subtree"}}],
    "removed": [{"parentId": "12:4", "index": 1, "id": "12:7"}],
    "updated": [{"parentId": "12:4", "index": 0, "id": "12:5", "replace": true, "node": {"...": "complete current properties"}}],
    "moved": [{"id": "12:8", "from": {"parentId": "12:4", "index": 2}, "to": {"parentId": "12:4", "index": 0}}]
  },
  "assetChanges": [],
  "definitions": {"variables": {}, "styles": {}, "components": {}},
  "assets": [],
  "warnings": []
}
```

The receiving agent must already have the baseline handoff. Node IDs are stable
Figma IDs. `added.node` contains a complete subtree; `updated.node` contains
the complete current node properties without children, and `replace: true`
means missing properties are removed rather than merged. Parent IDs and
zero-based child indexes describe insertion, removal, moves, and reordering.

Definition tables and the current retained asset table are always complete so
that a delta can be interpreted without reconstructing hidden prior state.
Asset changes are listed separately. A changed screenshot, vector rendering, or
original raster requires a new companion-asset handoff; `Copy changes` does not
copy replacement binaries.

The plugin keeps one in-memory baseline, scoped to the current page, selected
root IDs, and export options. A successful `Copy for AI`, or a completed
`Download handoff`, advances it. JSON copies, previews, individual asset
downloads, failed actions, and no-change checks do not.
