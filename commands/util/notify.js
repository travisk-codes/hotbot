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
  if (!id) return null

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
    .setName('notify')
    .setDescription('Get notified of guild, channel, or user activity.')
    .addNumberOption(option => option
      .setName('threshold')
      .setDescription('The number of messages per minute to trigger a notification.')
      .setRequired(true))
    .addNumberOption(option => option
      .setName('cooldown')
      .setDescription('The number of minutes to wait before sending another notification.')
      .setRequired(true))
    .addNumberOption(option => option
      .setName('lookback')
      .setDescription('The number of messages to look back when checking for activity.')
      .setRequired(true))
    .addStringOption(option => option
      .setName('id')
      .setDescription('The ID of the guild, channel, or user to be notified of.'))
    .addNumberOption(option => option
      .setName('users')
      .setDescription('The minimum number of users to be active in the conversation.'))
    .addStringOption(option => option
      .setName('summary')
      .setDescription('The type of summary to generate.')
      .addChoices(
        { name: 'short', value: 'short' },
        { name: 'long', value: 'long' },
        { name: 'bulleted', value: 'bulleted' },
      )),
  async execute(interaction) {
    UserSettings.sync()

    const threshold = interaction.options.get('threshold').value;
    const cooldown = interaction.options.get('cooldown').value;
    const lookback = interaction.options.get('lookback').value;
    const id = interaction.options.get('id')?.value;
    const users = interaction.options.get('users')?.value;
    const summary = interaction.options.get('summary')?.value;

    const target = await resolveTarget(id, interaction.client);
    console.log(target)
    if (target || target === null) {
      const targetType = target instanceof Discord.Guild
        ? 'guild'
        : (
          target instanceof Discord.User
            ? 'user'
            : (
              target !== null
                ? 'channel'
                : null
            )
        )
      const instance = await upsertUserSettings(interaction.user.id, threshold, cooldown, lookback, users, summary, id || null, targetType);
      // console.log(`targetType: ${targetType}`)
      // console.log(`targetId: ${id}`)
      // console.log(instance)
      return interaction.reply({
        embeds: [buildEmbed({
          isCreated: instance.isNewRecord,
          botAvatarURL: interaction.client.user.avatarURL(),
          target,
          threshold,
          cooldown,
          lookback,
          users,
          summary,
          interaction,
        })],
        ephemeral: true,
      });
    } else {
      return interaction.reply("Could not find a valid target for notification settings.");
    }
  }
}