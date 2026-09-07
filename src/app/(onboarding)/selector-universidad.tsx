import { StatusBar } from 'expo-status-bar';

import { SelectorCatalogo } from '@/components/SelectorCatalogo';
import { UNIVERSIDADES } from '@/constants/mock/catalogos';

/** Frame "Selector de universidad". */
export default function SelectorUniversidadScreen() {
  return (
    <>
      <StatusBar style="dark" />
      <SelectorCatalogo
        title="Tu universidad"
        searchPlaceholder="Busca tu universidad"
        items={UNIVERSIDADES}
        initialSelectedId="tec"
        paramKey="universidad"
      />
    </>
  );
}
