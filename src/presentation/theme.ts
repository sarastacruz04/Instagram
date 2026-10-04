// Paleta y tipografía inspiradas en Instagram (modo claro).
export const colors = {
  background: '#FFFFFF',
  text: '#000000',
  textSecondary: '#737373',
  border: '#DBDBDB',
  surface: '#EFEFEF',
  primary: '#0095F6',
  primaryDisabled: '#B2DFFC',
  like: '#FF3040',
  storyRing: '#D62976',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const typography = {
  logo: { fontSize: 28, fontWeight: '700' as const, fontStyle: 'italic' as const, letterSpacing: -0.5 },
  title: { fontSize: 16, fontWeight: '700' as const },
  username: { fontSize: 14, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.textSecondary },
};
