import type { DesignContext, DesignNode } from "../src/types";

export function fixtureContext(): DesignContext {
  const title: DesignNode = {
    id: "12:5",
    type: "TEXT",
    name: "Title \"primary\"",
    geometry: { height: 24, width: 295, x: 24, y: 24 },
    appearance: { blendMode: "NORMAL", fills: [{ color: "#1E1E1E", type: "SOLID" }], opacity: 1 },
    text: {
      characters: "Payment\nmethod",
      runs: [
        {
          characters: "Payment",
          end: 7,
          fontName: { family: "Inter", style: "Semi Bold" },
          fontSize: 20,
          fontWeight: 600,
          lineHeight: { unit: "PIXELS", value: 24 },
          start: 0,
        },
        {
          characters: "\nmethod",
          end: 14,
          fontName: { family: "Inter", style: "Regular" },
          fontSize: 18,
          fontWeight: 400,
          hyperlink: { type: "URL", value: "https://example.com?a=1&b=2" },
          start: 7,
        },
      ],
    },
    bindings: { fills: [{ id: "VariableID:color", type: "VARIABLE_ALIAS" }] },
  };

  const icon: DesignNode = {
    id: "12:9",
    type: "VECTOR",
    name: "Card / logo",
    geometry: { height: 24, rotation: 0, width: 40, x: 24, y: 72 },
    appearance: {
      effects: [{ color: "#00000033", offset: { x: 0, y: 2 }, radius: 4, type: "DROP_SHADOW" }],
      fills: [
        {
          gradientStops: [
            { color: "#FF0000", position: 0 },
            { color: "#0000FF", position: 1 },
          ],
          type: "GRADIENT_LINEAR",
        },
      ],
      isMask: false,
    },
    assetRefs: ["vector:12:9"],
  };

  const hidden: DesignNode = {
    id: "12:10",
    type: "RECTANGLE",
    name: "Hidden alternate",
    visible: false,
    geometry: { height: 40, width: 120, x: 24, y: 108 },
    appearance: { fills: [{ color: "#FFFFFF", opacity: 0.8, type: "SOLID" }] },
  };

  return {
    schema: "figmagent.design-context/v1",
    source: {
      document: "Checkout",
      page: "Mobile",
      units: "px",
      selection: ["12:4"],
    },
    roots: [
      {
        id: "12:4",
        type: "FRAME",
        name: "Payment card",
        geometry: { height: 188, width: 343, x: 0, y: 0 },
        layout: {
          counterAxisAlignItems: "MIN",
          itemSpacing: 16,
          layoutMode: "VERTICAL",
          layoutWrap: "NO_WRAP",
          paddingBottom: 24,
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 24,
        },
        appearance: {
          blendMode: "NORMAL",
          clipsContent: false,
          cornerRadius: 16,
          fills: [{ color: "#FFFFFF", type: "SOLID" }],
          opacity: 1,
        },
        component: {
          mainComponent: "ComponentID:card",
          properties: { State: { type: "VARIANT", value: "Selected" } },
        },
        interactions: [
          {
            actions: [{ destinationId: "12:20", navigation: "NAVIGATE", type: "NODE" }],
            trigger: { type: "ON_CLICK" },
          },
        ],
        annotations: [{ label: "Use an accessible payment group label" }],
        children: [title, icon, hidden],
      },
    ],
    definitions: {
      variables: {
        "VariableID:color": {
          id: "VariableID:color",
          name: "Primary",
          collection: "Text",
          type: "COLOR",
          mode: "Light",
          value: "#1E1E1E",
        },
      },
      styles: {
        "S:heading": { id: "S:heading", name: "Heading/Small", type: "TEXT" },
      },
      components: {
        "ComponentID:card": {
          id: "ComponentID:card",
          name: "Payment card",
          description: "A selectable payment method",
          variants: [
            { id: "C:1", name: "State=Default", properties: { State: "Default" } },
            { id: "C:2", name: "State=Selected", properties: { State: "Selected" } },
          ],
        },
      },
    },
    assets: [
      {
        id: "screenshot:12:4",
        kind: "screenshot",
        nodeId: "12:4",
        name: "Payment card",
        filename: "payment-card-reference.png",
        status: "available",
        width: 343,
        height: 188,
      },
      {
        id: "vector:12:9",
        kind: "vector",
        nodeId: "12:9",
        name: "Card / logo",
        filename: "card-logo.svg",
        status: "available",
        width: 40,
        height: 24,
      },
    ],
    warnings: [
      { code: "REMOTE_REFERENCE", message: "A remote definition was unavailable", nodeId: "12:4" },
    ],
  };
}
