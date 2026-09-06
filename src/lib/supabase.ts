/**
 * Cliente único de Supabase para toda la app.
 *
 * Importa siempre desde aquí (`import { supabase } from '@/lib/supabase'`);
 * no llames a `createClient` en otro lado — dos clientes se pelearían por el
 * mismo storage de sesión.
 *
 * Los tipos de `database.types.ts` se regeneran con `npm run gen:types` cada
 * vez que cambie el esquema. Solo cubren `public`: el esquema `private` está
 * deliberadamente fuera del Data API (ver migración 20260906000437).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import type { Database } from './database.types';
import { env } from './env';

/**
 * Adaptador de storage cifrado para la sesión de auth.
 *
 * SecureStore (Keychain / Android Keystore) es el lugar correcto para un
 * refresh token, pero rechaza payloads grandes — históricamente iOS corta
 * alrededor de 2 KB — y la sesión de Supabase los excede. La solución que
 * recomienda la guía oficial de Supabase para Expo: cifrar el valor con una
 * llave AES-256 nueva por escritura, guardar solo esa llave (32 bytes) en
 * SecureStore y el ciphertext en AsyncStorage.
 *
 * Nota: la guía de Supabase usa `react-native-get-random-values` para el
 * `crypto.getRandomValues` global. Aquí usamos `expo-crypto`, que da la misma
 * primitiva y sí viene incluido en Expo Go — el módulo de terceros obligaría a
 * un development build solo para esto.
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomValues(new Uint8Array(256 / 8));

    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      // La llave se perdió (reinstalación, borrado de keychain): el ciphertext
      // es basura irrecuperable. Devolver null hace que supabase-js lo trate
      // como "sin sesión" y mande al usuario a login, que es lo correcto.
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return null;
    }

    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);

    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: new LargeSecureStore(),
      autoRefreshToken: true,
      persistSession: true,
      // Obligatorio en React Native: no hay URL de navegador de la que parsear
      // un token, y dejarlo en true hace que auth-js busque un `window` que no
      // existe.
      detectSessionInUrl: false,
    },
  }
);

/**
 * Fuera del navegador, auth-js no puede saber si la app está en foreground y
 * refresca la sesión *continuamente* en background. Le damos esa señal con
 * AppState. Va a nivel de módulo a propósito: el cliente es un singleton, así
 * que el listener se registra exactamente una vez.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
