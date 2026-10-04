import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { colors } from '../theme';

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textSecondary}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: '#FAFAFA',
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.text,
  },
});
