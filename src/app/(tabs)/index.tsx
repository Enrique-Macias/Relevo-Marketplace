import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '@/constants/theme';

export default function InicioScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Inicio</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.paper,
  },
  text: {
    ...Typography.pageHeading,
    color: Colors.ink,
  },
});
