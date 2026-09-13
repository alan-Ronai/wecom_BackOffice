import argon2 from 'argon2';
export const hashPassword = (pw: string): Promise<string> =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = async (hash: string | null, pw: string): Promise<boolean> => {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
};
