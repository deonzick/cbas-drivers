export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CBAS Drivers";

/** CBAS logo: full-colour on light screens, white on dark screens (phone's light/dark mode),
 *  followed by the app's section name. Logo files live in public/brand/. */
export function Brand({ section, compact = false }: { section?: string; compact?: boolean }) {
  const rest = APP_NAME.replace(/^CBAS\s*/i, "") || "Drivers";
  return (
    <span className="brand">
      <picture>
        <source srcSet={compact ? "/brand/cbas-mark-white.svg" : "/brand/cbas-logo-white.svg"} media="(prefers-color-scheme: dark)" />
        <img className={compact ? "brand-mark" : "brand-logo"} src={compact ? "/brand/cbas-mark-color.svg" : "/brand/cbas-logo-color.svg"} alt="Community Builders Advisory Services" />
      </picture>
      <span className="brand-sep" aria-hidden="true" />
      <span className="brand-app">{section || rest}</span>
    </span>
  );
}
