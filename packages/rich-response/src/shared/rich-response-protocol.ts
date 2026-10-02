import { Type } from "typebox";

export const richFrameMessage = Type.Union([
  Type.Object({ type: Type.Literal("ready") }),
  Type.Object({ type: Type.Literal("size"), height: Type.Number({ minimum: 0, maximum: 1000000 }), overflow: Type.Boolean() }),
  Type.Object({ type: Type.Literal("error"), message: Type.String({ maxLength: 10000 }) }),
  Type.Object({ type: Type.Literal("link"), href: Type.String({ pattern: "^https?://", maxLength: 8192 }) }),
]);
export const richThemeMessage = Type.Object({ type: Type.Literal("theme"), theme: Type.String({ maxLength: 64 }), fontSize: Type.String({ pattern: "^\\d+(\\.\\d+)?px$" }) });
export const richConnectMessage = Type.Object({ type: Type.Literal("atelier-rich-connect") });
