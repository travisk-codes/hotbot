// import { createRequire } from 'module'
// const require = createRequire(import.meta.url)

// import path from 'path'
// import { fileURLToPath } from 'url'
// const __filename = fileURLToPath(import.meta.url)
// const __dirname = path.dirname(__filename)


const Discord = require('discord.js')
const Sequelize = require('sequelize')

const sequelize = new Sequelize('database', 'user', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  logging: false,
  storage: 'database.sqlite',
})

const UserSettings = sequelize.define('userSettings', {
  userId: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  threshold: {
    type: Sequelize.INTEGER,
    defaultValue: 1,
    allowNull: false,
  },
  cooldown: {
    type: Sequelize.INTEGER,
    defaultValue: 5,
    allowNull: false,
  },
  lookback: {
    type: Sequelize.INTEGER,
    defaultValue: 10,
    allowNull: false,
  },
  targetId: {
    type: Sequelize.STRING,
    defaultValue: null,
    allowNull: true,
  },
  targetType: {
    type: Sequelize.STRING,
    defaultValue: null,
    allowNull: true,
  },
  users: {
    type: Sequelize.INTEGER,
    defaultValue: 2,
    allowNull: true,
  },
  summary: {
    type: Sequelize.STRING,
    defaultValue: null,
    allowNull: true,
  },
})

function buildEmbed({
  isCreated,
  botAvatarURL,
  target,
  threshold,
  cooldown,
  lookback,
  users,
  summary,
  interaction,
}) {
  // Function to handle singular or plural text
  function pluralize(value, unit) {
    return value === 1 ? `${value} ${unit}` : `${value} ${unit}s`;
  }

  // Determine the thumbnail URL based on the target
  let thumbnailURL;

  if (target instanceof Discord.Guild) {
    // If the target is a server (guild), use the server's icon URL
    thumbnailURL = target.iconURL()
  } else if (target instanceof Discord.User) {
    // If the target is a user, use the user's avatar URL
    thumbnailURL = target.avatarURL()
  } else {
    // if   the target id is a channel
    // then use the guild icon
    let channel
    try {
      channel = target.client.channels.cache.get(target.id)
    } catch (error) { }
    if (channel) {
      thumbnailURL = channel.guild.iconURL()
    } else {
      thumbnailURL = interaction.client.user.avatarURL()
    }
  }

  return new Discord.EmbedBuilder()
    .setTitle(`Notification settings ${isCreated ? 'created' : 'updated'}!`)
    .setThumbnail(thumbnailURL)
    .addFields(
      { name: 'Target', value: `${target === null ? 'All' : target.toString()}`, inline: true },
      { name: 'Threshold', value: `${pluralize(threshold, 'message')} per minute`, inline: true },
      { name: 'Cooldown', value: `${pluralize(cooldown, 'minute')}`, inline: true },
      { name: 'Lookback', value: `${pluralize(lookback, 'message')}`, inline: true },
      { name: 'Users', value: `${users || 2} minimum`, inline: true },
      { name: 'Summary', value: `${summary || 'none'}`, inline: true },
    )
    .setTimestamp()
    .setColor(0xffcb4c)
}

async function upsertUserSettings(userId, threshold, cooldown, lookback, users, summary, targetId, targetType) {
  console.log(`userId: ${userId}`)
  console.log(`targetId: ${targetId}`)
  console.log(`targetType: ${targetType}`)
  // find the user settings where the user id and the target id are the same
  const existingRow = await UserSettings.findAll({
    where: {
      [Sequelize.Op.and]: [
        { userId },
        { targetId: targetId || null },
      ]
    }
  })
  console.log(existingRow.length)
  if (existingRow.length) {
    // if the row exists, update it
    return await UserSettings.update({
      threshold,
      cooldown,
      lookback,
      users,
      summary,
      targetId: targetId || null,
      targetType,
    }, {
      where: {
        [Sequelize.Op.and]: [
          { userId },
          { targetId: targetId || null },
        ]
      }
    })
  } else {
    // if the row does not exist, create it
    return await UserSettings.create({
      userId,
      threshold,
      cooldown,
      lookback,
      users,
      summary,
      targetId: targetId || null,
      targetType,
    })
  }
}

async function resolveTarget(id, client) {
  if (!id) return { name: 'All' }

  try {
    const guild = await client.guilds.fetch(id)
    if (guild) return guild
  } catch (error) { }

  try {
    const channel = await client.channels.fetch(id)
    if (channel) return channel
  } catch (error) { }

  try {
    const user = await client.users.fetch(id)
    if (user) return user
  } catch (error) { }
}

module.exports = {
  data: new Discord.SlashCommandBuilder()
    .setName('list')
    .setDescription('Show all notification settings'),
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return
    UserSettings.sync()
    const allSettings = await UserSettings.findAll({ where: { userId: interaction.user.id } })
    const selectOptions = await Promise.all(allSettings.map(async s => {
      const target = await resolveTarget(s.targetId, interaction.client)
      return new Discord.StringSelectMenuOptionBuilder()
        .setLabel(target.name || target.username)
        .setValue(s.targetId || 'all')
        .setDescription(s.targetType !== null ? s.targetType : 'global settings')
    }))
    const select = new Discord.StringSelectMenuBuilder()
      .setCustomId('list')
      .setPlaceholder('Select notification settings')
      .addOptions(...selectOptions)
    const row = new Discord.ActionRowBuilder()
      .addComponents(select)
    await interaction.reply({ components: [row], ephemeral: true })
  }
}