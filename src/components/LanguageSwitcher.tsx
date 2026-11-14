import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

interface LanguageSwitcherProps {
  className?: string;
  showIcon?: boolean;
}

export function LanguageSwitcher({ className, showIcon = true }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const current = (i18n.language?.slice(0, 2) as SupportedLanguage) || "ru";

  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border bg-background/60 p-0.5 backdrop-blur", className)}>
      {showIcon && <Languages className="ml-1.5 size-3.5 text-muted-foreground" />}
      <div className="flex items-center gap-0.5">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const active = current === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => setLanguage(lang.code)}
              title={lang.label}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {lang.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
