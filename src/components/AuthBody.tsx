/** `.auth-body` — el esqueleto que comparten las 5 pantallas de auth. */

import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { Isotipo } from '@/components/BrandLogo';
import { Colors, Radii, Typography } from '@/constants/theme';

export function AuthBody({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.body, style]}>{children}</View>;
}

/**
 * `.auth-logo` — cuadro de 52px en --mint-900 con el isotipo menta de 38px
 * (Paleta 06). "Recuperar contraseña" lo pinta `--forest` y lo deja **sin
 * isotipo**, de ahí que la marca sea opcional.
 */
export function AuthLogo({ background = Colors.mint900, marca = false }: { background?: string; marca?: boolean }) {
  return (
    <View
      style={[styles.logo, { backgroundColor: background }]}
      accessible={marca}
      accessibilityRole={marca ? 'image' : undefined}
      accessibilityLabel={marca ? 'RLVO' : undefined}
    >
      {marca ? <Isotipo width={38} color={Colors.mint400} /> : null}
    </View>
  );
}

export function AuthHeadline({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.headline, style]}>{children}</Text>;
}

export function AuthSub({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.sub, style]}>{children}</Text>;
}

/** `.auth-link` — el `<b>` interno va en `--brick` semibold; se pasa como hijo. */
export function AuthLink({ children }: { children: React.ReactNode }) {
  return <Text style={styles.link}>{children}</Text>;
}

export function AuthLinkStrong({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <Text style={styles.linkStrong} onPress={onPress} suppressHighlighting>
      {children}
    </Text>
  );
}

export function AuthTerms({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.terms, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  // .auth-body{padding:44px 24px 0; align-items:center; text-align:center;}
  body: {
    paddingTop: 44,
    paddingHorizontal: 24,
    paddingBottom: 0,
    alignItems: 'center',
  },
  // .auth-logo{width:52px; height:52px; border-radius:16px; background:var(--mint-900); margin-bottom:26px;}
  logo: {
    width: 52,
    height: 52,
    borderRadius: Radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  // .auth-headline{font-size:22px; margin-bottom:9px; max-width:250px;}
  headline: {
    ...Typography.headline,
    color: Colors.ink,
    marginBottom: 9,
    maxWidth: 250,
    textAlign: 'center',
  },
  // .auth-sub{font-size:13px; line-height:1.55; margin-bottom:28px; max-width:250px;}
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    marginBottom: 28,
    maxWidth: 250,
    textAlign: 'center',
  },
  // .auth-link{font-size:12.5px; color:var(--ink-soft); margin-top:22px;}
  link: {
    ...Typography.meta,
    color: Colors.inkSoft,
    marginTop: 22,
    textAlign: 'center',
  },
  // .auth-link b{color:var(--brick); font-weight:600;}
  linkStrong: {
    ...Typography.label,
    color: Colors.brick,
  },
  // .auth-terms{font-size:11px; color:var(--ink-soft); margin-top:18px; line-height:1.5; max-width:250px;}
  terms: {
    ...Typography.terms,
    color: Colors.inkSoft,
    marginTop: 18,
    maxWidth: 250,
    textAlign: 'center',
  },
});
