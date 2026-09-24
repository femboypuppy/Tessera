import { z } from 'zod';
import { AuthService } from '../auth/auth-service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/passwords';
import type { ServerConfig } from '../config';
import { openDatabase } from '../db/database';

const inputSchema = z.object({
  email: z.email('The email address is not valid.'),
  name: z.string().trim().min(1, 'The name must not be empty.').max(80),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH),
});

/**
 * Creates the server owner (the first account) directly in the database. Works while the server
 * runs (SQLite WAL allows it) and refuses once any account exists.
 */
export async function createOwner(
  config: Pick<ServerConfig, 'dataDir' | 'sessionDays'>,
  input: { email: string; name: string; password: string },
): Promise<{ id: string; email: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join(' '));
  const db = openDatabase(config.dataDir);
  try {
    const auth = new AuthService(db, { sessionDays: config.sessionDays });
    if (auth.hasUsers())
      throw new Error('This server already has accounts. Sign in with the owner account instead.');
    const user = await auth.createUser({ ...parsed.data, isOwner: true });
    return { id: user.id, email: user.email };
  } finally {
    db.close();
  }
}
