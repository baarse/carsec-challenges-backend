import bcrypt from 'bcrypt'
import { createUserChallenge } from './user-challenges-queries'
import { createUserKey } from './user-keys-queries'
import { getPool } from './connection'
import { listChallenges } from './challenges-queries'
import { listHardwareKeys } from './hardware-keys-queries'
import passwordGenerator from 'generate-password'

export async function listUsersWithTeams() {
  const db = await getPool()

  return db.query(`
  select u.id, u.role, u.email, t.name team
  from users u
  left join teams t on u.teamId = t.id
  order by t.name, u.id`)
}

export async function listUsers() {
  const db = await getPool()

  return db.query('select * from users')
}

export async function getUserById(userId) {
  const db = await getPool()

  return db.query('select * from users where id = ?', [userId])
}

export async function getUsersByEmail(email) {
  const db = await getPool()

  return db.query(
    `
  select u.*, t.name team
  from users u 
  left join teams t on u.teamId = t.id
  where email = ?`,
    [email]
  )
}

export async function createUser(email, passwordHash, teamId, role) {
  const db = await getPool()

  return db.getConnection().then(async connection => {
    try {
      const [{ insertId: userId }] = await db.query(
        'insert into users (teamId, role, email, password) values( ?, ?, ?, ?)',
        [teamId, role, email, passwordHash]
      )

      const [hardwareKeys] = await listHardwareKeys()

      for (const { id } of hardwareKeys) {
        await createUserKey(connection, id, userId)
      }

      const [challenges] = await listChallenges()

      for (const { id: challengeId } of challenges) {
        await createUserChallenge(connection, userId, challengeId)
      }

      await connection.commit()

      return userId
    } catch (error) {
      await connection.rollback()

      throw error
    } finally {
      await connection.release()
    }
  })
}

export async function changeUserPassword(userId, password, passwordCheck, oldPassword) {
  const db = await getPool()

  return db.getConnection().then(async connection => {
    try {
      if (password !== passwordCheck) {
        throw new Error('New passwords do not match')
      }

      const [[user]] = await getUserById(userId)

      if (!user) {
        throw new Error('Unknown user')
      }

      const { password: passwordHash } = user

      const match = await bcrypt.compareSync(oldPassword, passwordHash)

      if (!match) {
        throw new Error('Old password incorrect')
      }

      return bcrypt.hash(password, 10).then(async updatedPasswordHash => {
        const [updatedUser] = await db.query(
          `update users
          set password = ?
          where id = ?`,
          [updatedPasswordHash, userId]
        )

        await connection.commit()

        return updatedUser
      })
    } catch (error) {
      await connection.rollback()

      throw error
    } finally {
      await connection.release()
    }
  })
}

export async function resetUserPassword(userId) {
  const db = await getPool()

  return db.getConnection().then(async connection => {
    try {
      const password = passwordGenerator.generate({ length: 10, numbers: true })

      return bcrypt.hash(password, 10).then(async passwordHash => {
        const [user] = await db.query(
          `update users
          set password = ?
          where id = ?`,
          [passwordHash, userId]
        )

        await connection.commit()

        return { password, user }
      })
    } catch (error) {
      await connection.rollback()

      throw error
    } finally {
      await connection.release()
    }
  })
}

export async function deleteUserById(userIds) {
  const db = await getPool()

  return db.getConnection().then(async connection => {
    try {
      let queryParameters = userIds

      if (Array.isArray(userIds)) {
        queryParameters = userIds.join()
      }

      let query = `delete from users where id in (${queryParameters})`

      const [user] = await db.query(query)

      await connection.commit()

      return user
    } catch (error) {
      await connection.rollback()

      throw error
    } finally {
      await connection.release()
    }
  })
}
