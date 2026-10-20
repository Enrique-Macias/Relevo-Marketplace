/**
 * Config plugin: tab bar de Android más compacta (ANDROID-2F).
 *
 * POR QUÉ EXISTE. En Android, `NativeTabs` de expo-router dibuja la barra con un
 * `BottomNavigationView` de Material que react-native-screens tematiza con
 * `Theme.Material3.DayNight.NoActionBar` (`TabsContainer.kt`, react-native-screens
 * 4.26.2). El estilo `Widget.Material3.BottomNavigationView` de Material 1.13.0
 * le da 80dp de alto mínimo, con 12dp de padding arriba y 16dp abajo, y además
 * le suma como padding el inset de la barra de navegación del sistema. En un
 * Redmi físico eso se ve demasiado alto: una franja vacía grande sobre los
 * íconos. `NativeTabs` no expone ninguna prop de altura ni de padding en
 * Android, así que la única palanca sin parchear librerías es sobrescribir los
 * recursos de Material desde la app: en Android los recursos de la app ganan
 * sobre los de una librería con el mismo nombre.
 *
 * QUÉ CAMBIA. Solo tres `<dimen>` de `res/values/dimens.xml` (80/12/16 → 64/8/8).
 * `m3_bottom_nav_min_height` es un PISO, no la altura: Material mide la barra
 * según su contenido (`BottomNavigationView.onMeasure`), y el item seleccionado
 * suma padding top + indicador (32) + 4 + etiqueta (16) + padding bottom. Con
 * 8/8 eso da 68dp, por encima del piso de 64: la altura efectiva medida en un
 * Redmi físico con font_scale 1.0 es 68dp (antes, 80). Bajar solo el piso no
 * baja la barra.
 * NO toca el inset del sistema (`paddingBottomSystemWindowInsets` sigue en true:
 * nada queda debajo de los botones de MIUI), ni etiquetas, íconos, indicador ni
 * colores. iOS no se entera: son recursos de Android.
 *
 * RIESGO, Y POR QUÉ ESTE COMENTARIO ES LARGO. Los nombres `m3_bottom_nav_*` son
 * recursos INTERNOS de Material, no API pública. Si una versión futura de
 * Material (o de react-native-screens, que la trae) los renombra, esta
 * sobrescritura deja de aplicar SIN ningún error y la barra vuelve a 80dp.
 * Revisar al actualizar react-native-screens o com.google.android.material:
 * los nombres siguen existiendo en `res/values/values.xml` del AAR. Afecta a
 * cualquier BottomNavigationView de Material 3 de la app (hoy solo existe esta).
 *
 * ACOPLAMIENTO. `ALTURA_TAB_BAR` de Android en `src/components/PublicarFab.tsx`
 * guarda la altura EFECTIVA de la barra (68dp hoy), no `m3_bottom_nav_min_height`:
 * la barra nativa no devuelve su altura a JS y el FAB la despeja a mano. Si
 * cambian estos valores, hay que volver a medir la barra y ajustar esa constante.
 */
const { AndroidConfig, XML, withDangerousMod } = require('expo/config-plugins');

const DIMENS = {
  m3_bottom_nav_min_height: '64dp',
  m3_bottom_nav_item_padding_top: '8dp',
  m3_bottom_nav_item_padding_bottom: '8dp',
};

async function escribirDimens(projectRoot) {
  const path = await AndroidConfig.Paths.getResourceXMLPathAsync(projectRoot, { name: 'dimens' });
  const xml = await AndroidConfig.Resources.readResourcesXMLAsync({ path });
  const nombres = new Set(Object.keys(DIMENS));
  const previos = (xml.resources.dimen ?? []).filter((item) => !nombres.has(item.$.name));
  xml.resources.dimen = [
    ...previos,
    ...Object.entries(DIMENS).map(([name, value]) =>
      AndroidConfig.Resources.buildResourceItem({ name, value }),
    ),
  ];
  await XML.writeXMLAsync({ path, xml });
}

module.exports = function withCompactAndroidTabBar(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      await escribirDimens(config.modRequest.projectRoot);
      return config;
    },
  ]);
};
