import { StatusBar } from 'expo-status-bar';

import { SelectorCatalogo } from '@/components/SelectorCatalogo';
import { CAMPUS } from '@/constants/mock/catalogos';

/** Frame "Selector de campus (onboarding)". */
export default function SelectorCampusScreen() {
  return (
    <>
      <StatusBar style="dark" />
      <SelectorCatalogo
        title="Tu campus"
        searchPlaceholder="Busca tu campus"
        items={CAMPUS}
        initialSelectedId="mty"
        paramKey="campus"
      />
    </>
  );
}
