import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, fonts, space } from '@shared/design/tokens';
import { themedStyles } from '@shared/design/theme';

import { BrandEmblem } from './BrandEmblem';

type Props = {
  title?: string;
  /** Muestra una flecha "Atrás" que vuelve a la pantalla anterior. */
  back?: boolean;
  /** `false` cuando la pantalla trae su propia lista (FlatList): evita anidar scrolls. */
  scroll?: boolean;
  /** Fuera de las pestañas no hay barra inferior que ya reserve el margen. */
  withBottomInset?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
};

/**
 * Contenedor común de pantallas: respeta las zonas seguras de Android, dibuja
 * la cabecera de THERS y reubica el contenido cuando aparece el teclado.
 */
export function Screen({
  title,
  back = false,
  scroll = true,
  withBottomInset = true,
  headerRight,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const header =
    title || back ? (
      <View style={styles.header}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={12}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.emblem}>
            <BrandEmblem />
          </View>
        )}
        {title ? (
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <View style={styles.headerRight}>{headerRight}</View>
      </View>
    ) : null;

  const bottom = withBottomInset ? insets.bottom + space[4] : space[4];

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { paddingTop: insets.top }]}
      behavior="padding"
    >
      {header}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => ({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bg,
  },
  emblem: { marginRight: space[3] },
  back: { marginRight: space[2], paddingRight: space[2] },
  backText: { fontSize: 32, lineHeight: 34, color: colors.fg },
  title: { flex: 1, fontSize: fontSize.headlineSm, fontFamily: fonts.display, color: colors.fg },
  headerRight: { marginLeft: space[2] },
  content: { padding: space[4] },
}));
