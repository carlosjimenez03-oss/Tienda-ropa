import { Secret, TOTP } from 'otpauth';

export function nuevoSecreto(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpPara(secreto: string, email: string): TOTP {
  return new TOTP({
    issuer: 'Inventario',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secreto),
  });
}

export function verificarCodigo(secreto: string, email: string, codigo: string): boolean {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;
  return totpPara(secreto, email).validate({ token: limpio, window: 1 }) !== null;
}
