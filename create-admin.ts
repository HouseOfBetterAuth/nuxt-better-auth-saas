import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { v7 as uuidv7 } from 'uuid'
import 'dotenv/config'

const { Pool } = pg

// Database connection
const pool = new Pool({
  connectionString: process.env.NUXT_DATABASE_URL
})
const db = drizzle(pool)

// Schema definition (simplified from your project)
const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  role: text('role'),
  banned: boolean('banned').default(false)
})

const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
})

const schema = { user, account, verification, session }

// Initialize Better Auth
const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
  }),
  emailAndPassword: {
    enabled: true
  },
  advanced: {
    database: {
      generateId: () => uuidv7()
    }
  }
})

async function createAdminUser() {
  const email = process.env.NUXT_ADMIN_EMAIL || 'admin@nuxsaas.com'
  const password = process.env.NUXT_ADMIN_PASSWORD || 'admin-password'
  const name = 'Admin User'

  console.log(`Creating admin user: ${email}`)

  try {
    // Using better-auth to sign up
    const newUser = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name
      },
      asResponse: false
    })

    if (newUser && newUser.user) {
      console.log('User created successfully:', newUser.user.id)

      // Update role to admin
      await db.update(user)
        .set({ role: 'admin', emailVerified: true })
        .where(eq(user.id, newUser.user.id))

      console.log('User promoted to admin successfully')
    }
  } catch (error: any) {
    if (error.message && error.message.includes('User already exists')) {
      console.log('User already exists. Updating role to admin...')

      // Try to find the user directly via db to update role
      const foundUsers = await db.select().from(user).where(eq(user.email, email))

      if (foundUsers.length > 0) {
        const foundUser = foundUsers[0]
        await db.update(user)
          .set({ role: 'admin', emailVerified: true })
          .where(eq(user.id, foundUser.id))
        console.log(`User ${foundUser.email} promoted to admin successfully.`)
      } else {
        console.log('Could not find user to promote.')
      }
    } else {
      console.error('Error creating admin user:', error)
      if (error.body) {
        console.error('Error body:', error.body)
      }
    }
  } finally {
    await pool.end()
  }
}

createAdminUser()
