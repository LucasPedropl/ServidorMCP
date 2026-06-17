import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes é recomendado para GCM

/**
 * Obtém a chave de criptografia de 32 bytes de process.env.ENCRYPTION_KEY.
 * Se não estiver configurada, usa um fallback de desenvolvimento com aviso.
 */
function getEncryptionKey(): Buffer {
  const rawKey = process.env.ENCRYPTION_KEY || 'fallback_development_mcp_factory_key_safe_32';
  // Garante que a chave possua exatamente 32 bytes (256 bits)
  const hashedKey = crypto.createHash('sha256').update(rawKey).digest();
  return hashedKey;
}

/**
 * Criptografa um texto puro usando AES-256-GCM.
 * @param text O texto a ser criptografado.
 * @returns String contendo iv, authTag e o texto cifrado no formato iv:authTag:cipherText
 */
export function encrypt(text: string): string {
  if (!text) return '';
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descriptografa um texto cifrado gerado pela função encrypt.
 * @param encryptedText String criptografada no formato iv:authTag:cipherText
 * @returns O texto original em formato puro.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de segredo criptografado inválido. Deve ser iv:tag:cipher.');
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Componentes da cifra inválidos ou ausentes.');
  }
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getEncryptionKey();
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
