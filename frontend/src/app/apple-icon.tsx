import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#1a1108",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
        }}
      >
        <svg
          width="100"
          height="100"
          viewBox="0 0 64 64"
          fill="none"
          stroke="#e0894d"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.75"
        >
          <path d="M14 42l18 7 18-7" opacity="0.35" />
          <path d="M14 33l18 7 18-7" opacity="0.65" />
          <path d="M32 15L14 24l18 9 18-9-18-9z" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
