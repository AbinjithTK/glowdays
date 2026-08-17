/**
 * Shelf routes.
 *
 * Products are typed in by the user. There is deliberately no catalogue lookup
 * and no purchase link: recommending or selling a product would make every
 * comparison read as a claim we have a commercial interest in.
 */

import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.js';
import { product, trial } from '../db/schema.js';
import { currentProfileId, type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';

const KINDS = ['cleanser', 'serum', 'moisturiser', 'sunscreen', 'treatment', 'other'] as const;

const UpsertProduct = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).optional(),
  kind: z.enum(KINDS).default('other'),
  /** Accepts a past date. A product may have been in use before the diary. */
  startedOn: z.string().date().optional(),
});

export const productsRoute = new Hono<AppEnv>();

productsRoute.post('/', async (c) => {
  const profileId = currentProfileId(c);
  const input = UpsertProduct.parse(await c.req.json().catch(() => ({})));

  const inserted = await db()
    .insert(product)
    .values({
      profileId,
      name: input.name,
      brand: input.brand ?? null,
      kind: input.kind,
      startedOn: input.startedOn ?? null,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new AppError('internal', 'Product was not created');
  return c.json({ product: row }, 201);
});

productsRoute.get('/', async (c) => {
  const profileId = currentProfileId(c);
  const rows = await db()
    .select()
    .from(product)
    .where(eq(product.profileId, profileId))
    .orderBy(desc(product.createdAt));

  const trials = await db()
    .select({ productId: trial.productId, status: trial.status })
    .from(trial)
    .where(eq(trial.profileId, profileId));

  const testing = new Set(trials.filter((t) => t.status === 'active').map((t) => t.productId));

  return c.json({
    products: rows.map((r) => ({ ...r, testing: testing.has(r.id) })),
  });
});

productsRoute.patch('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const input = UpsertProduct.partial().parse(await c.req.json().catch(() => ({})));

  const updated = await db()
    .update(product)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.startedOn !== undefined ? { startedOn: input.startedOn } : {}),
    })
    .where(and(eq(product.id, c.req.param('id')), eq(product.profileId, profileId)))
    .returning();

  const row = updated[0];
  if (!row) throw new AppError('not_found', 'No such product');
  return c.json({ product: row });
});

productsRoute.delete('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const id = c.req.param('id');

  // A product referenced by a trial is not deletable. Removing it would leave
  // a comparison with no subject, which is worse than refusing.
  const used = await db()
    .select({ id: trial.id })
    .from(trial)
    .where(and(eq(trial.productId, id), eq(trial.profileId, profileId)))
    .limit(1);
  if (used[0]) {
    throw new AppError('conflict', 'This product is part of a trial', {
      detail: 'Archive the trial first. Its check-ins stay in your diary either way.',
    });
  }

  const deleted = await db()
    .delete(product)
    .where(and(eq(product.id, id), eq(product.profileId, profileId)))
    .returning({ id: product.id });
  if (!deleted[0]) throw new AppError('not_found', 'No such product');
  return c.json({ deleted: true });
});
