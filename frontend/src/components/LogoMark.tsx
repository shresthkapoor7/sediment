import type { SVGProps } from "react";

const LOGO_PATHS = [
  "M93 36C67 39 53 57 53 82v27c0 30-11 49-36 55",
  "M136 36c-26 3-40 21-40 46v27c0 30-11 49-36 55",
  "M179 36c-26 3-40 21-40 46v27c0 30-11 49-36 55",
];

export function LogoMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 216 192"
      fill="none"
      stroke="currentColor"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {LOGO_PATHS.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

type LoadingLogoMarkProps = SVGProps<SVGSVGElement> & {
  reducedMotion?: boolean;
};

export function LoadingLogoMark({
  className,
  reducedMotion = false,
  ...props
}: LoadingLogoMarkProps) {
  return (
    <svg
      viewBox="0 0 216 192"
      fill="none"
      stroke="currentColor"
      strokeWidth="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {LOGO_PATHS.map((path) => (
        <path key={path} d={path} opacity="0.22" />
      ))}
      {!reducedMotion &&
        LOGO_PATHS.map((path, index) => (
          <path
            key={`current-${path}`}
            d={path}
            className="sediment-logo-pulse-path"
            style={{ animationDelay: `${index * 0.12}s` }}
          />
        ))}
      {reducedMotion &&
        LOGO_PATHS.map((path) => <path key={`static-${path}`} d={path} />)}
    </svg>
  );
}
