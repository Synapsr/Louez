import { Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { emailTheme, styles } from "./theme";

interface EmailTextProps {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  bold?: boolean;
  center?: boolean;
  style?: CSSProperties;
}

/** The one paragraph primitive; variants replace per-template style consts. */
export function EmailText({ children, muted, small, bold, center, style }: EmailTextProps) {
  return (
    <Text
      style={{
        ...styles.paragraph,
        ...(small ? styles.small : null),
        ...(muted ? { color: emailTheme.colors.muted } : null),
        ...(bold ? { fontWeight: "600", color: emailTheme.colors.ink } : null),
        ...(center ? { textAlign: "center" as const } : null),
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
