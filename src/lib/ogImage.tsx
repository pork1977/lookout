import { ImageResponse } from "next/og";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };
export const OG_IMAGE_CONTENT_TYPE = "image/png";

export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0e0d",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            height: 96,
            width: 96,
            borderRadius: 24,
            border: "6px solid #5ae29e",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", height: 20, width: 20, borderRadius: 999, background: "#5ae29e" }} />
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 88, fontWeight: 600, color: "#f4f6f5" }}>
          Lookout
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 34, color: "#9db3ac" }}>
          Teach your camera to notice anything.
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
