import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          background: "#131314",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
        }}
      >
        <svg
          width="100"
          height="100"
          viewBox="0 0 216 192"
          fill="none"
          stroke="#FFFFFF"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="12"
        >
          <path d="M93 36C67 39 53 57 53 82v27c0 30-11 49-36 55" />
          <path d="M136 36c-26 3-40 21-40 46v27c0 30-11 49-36 55" />
          <path d="M179 36c-26 3-40 21-40 46v27c0 30-11 49-36 55" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
