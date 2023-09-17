const fs = require('node:fs')
const path = require('node:path')
const moment = require('moment')
const Sequelize = require('sequelize')
const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js')
const Discord = require('discord.js')
const { discordUserToken } = require('./config.json')
const { send } = require('express/lib/response')

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	]
})

function pluralize(value, unit) {
	return value === 1 ? `${value} ${unit}` : `${value} ${unit}s`;
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

async function getChannelSpeed(channel, lookback) {
	const messages = await channel.messages.fetch({ limit: lookback })
	// console.log(`messages: ${messages.size}`)
	const firstMessageTime = messages.first().createdTimestamp
	// console.log(`first message time: ${firstMessageTime}`)
	const lastMessageTime = messages.last().createdTimestamp
	// console.log(`last message time: ${lastMessageTime}`)
	const timeDifference = moment.duration(moment(firstMessageTime).diff(moment(lastMessageTime)))
	// console.log(`time difference: ${timeDifference.asMinutes()}`)
	const messagesPerMinute = lookback / timeDifference.asMinutes()
	// console.log(`messages per minute: ${messagesPerMinute}`)
	return messagesPerMinute
}

function resolveSettings(settings, msg) {
	// get global settings
	const globalSettings = settings.filter(s => s.targetId === null)[0]
	// get guild settings
	const guildSettings = settings.filter(s => s.targetId === msg.guild.id)[0]
	// get channel settings
	const channelSettings = settings.filter(s => s.targetId === msg.channel.id)[0]
	// get any user settings
	const userSettings = settings.filter(s => s.targetType === 'user')[0]
	// for each user setting lookback, see if the user has sent more than the lookback in the last minute
	// const userSettingsWithMessagesPerMinute = userSettings.map(async s => {
	// 	const messagesPerMinute = await getChannelSpeed(msg.channel, s.lookback)
	// 	return { ...s, messagesPerMinute }
	// })
	// // for each user setting, see if the messagesPerMinute is greater than the threshold
	// const userSettingsThatExceedThreshold = userSettingsWithMessagesPerMinute.filter(s => s.messagesPerMinute > s.threshold)
	// return the settings that are active
	return {
		global: globalSettings,
		guild: guildSettings,
		channel: channelSettings,
		// users: userSettingsThatExceedThreshold,
	}
}

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
			{ name: 'Target', value: `${target === 'All' ? 'All' : target.toString()}`, inline: true },
			{ name: 'Threshold', value: `${pluralize(threshold, 'message')} per minute`, inline: true },
			{ name: 'Cooldown', value: `${pluralize(cooldown, 'minute')}`, inline: true },
			{ name: 'Lookback', value: `${pluralize(lookback, 'message')}`, inline: true },
			{ name: 'Users', value: `${users || 2} minimum`, inline: true },
			{ name: 'Summary', value: `${summary || 'none'}`, inline: true },
		)
		.setTimestamp()
		.setColor(0xffcb4c)
}

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

client.commands = new Collection()
const foldersPath = path.join(__dirname, 'commands')
const commandFolders = fs.readdirSync(foldersPath)

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder)
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file)
		const command = require(filePath)
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command)
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`)
		}
	}
}

const userIdsWithSettingsCache = []

client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isStringSelectMenu()) {
		const targetId = interaction.values[0] === 'all' ? null : interaction.values[0]
		// await interaction.deferReply()
		// display an embed with information about their selected target
		const notifSettings = await UserSettings.findOne({ where: { userId: interaction.user.id, targetId } })
		function pluralize(value, unit) {
			return value === 1 ? `${value} ${unit}` : `${value} ${unit}s`;
		}

		// Determine the thumbnail URL based on the target
		let thumbnailURL;

		const target = await resolveTarget(interaction.values[0], interaction.client)

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

		userIdsWithSettingsCache.push(interaction.user.id)

		await interaction.update({
			embeds: [new Discord.EmbedBuilder()
				.setTitle(`Notification settings for ${target === undefined ? 'everything' : target.toString()}`)
				.setThumbnail(thumbnailURL)
				.addFields(
					{ name: 'Target', value: `${target === undefined ? 'everything' : target.toString()}`, inline: true },
					{ name: 'Threshold', value: `${pluralize(notifSettings.threshold, 'message')} per minute`, inline: true },
					{ name: 'Cooldown', value: `${pluralize(notifSettings.cooldown, 'minute')}`, inline: true },
					{ name: 'Lookback', value: `${pluralize(notifSettings.lookback, 'message')}`, inline: true },
					{ name: 'Users', value: `${notifSettings.users} minimum`, inline: true },
					{ name: 'Summary', value: `${notifSettings.summary || 'none'}`, inline: true },
				)
				.setTimestamp()
				.setColor(0xffcb4c)
			]
		})
	}

	if (!interaction.isChatInputCommand()) return

	const cmd = interaction.client.commands.get(interaction.commandName)

	if (!cmd) {
		console.error(`No command matching ${interaction.commandName} was found.`)
		return
	}

	try {
		await cmd.execute(interaction)
	} catch (error) {
		console.error(error)
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
		}
	}
})

client.once(Events.ClientReady, c => {
	console.log(`Ready! Logged in as ${c.user.tag}`)
})

async function sendNotificationIfCriteriaMet(msg, settings) {
	const threshold = settings.threshold
	const lookback = settings.lookback
	const channelSpeed = await getChannelSpeed(msg.channel, lookback)
	if (channelSpeed < threshold) return

	const cooldown = settings.cooldown
	const dms = await msg.author.createDM()
	const lastDm = await dms.messages.fetch({ limit: 1 })
	const lastDmTime = lastDm.first().createdTimestamp
	const timeDifference = moment.duration(moment().diff(moment(lastDmTime)))
	if (timeDifference.asMinutes() < cooldown) return

	const userCount = settings.users
	const messages = await msg.channel.messages.fetch({ limit: lookback })
	const activeChatters = messages.reduce((acc, message) => {
		if (message.author.bot) return acc
		if (acc.includes(message.author)) return acc
		return [...acc, message.author]
	}, [])
	if (activeChatters < userCount) return

	console.log(`${msg.channel.name} in ${msg.guild.name}: ${channelSpeed.toFixed(1)} m/m (${threshold})`)

	const activeChattersFields = activeChatters.map(user => {
		return { name: user.nickname || user.username, value: user.toString(), inline: true }
	})
	const channelLink = msg.channel.toString()
	const target = await resolveTarget(settings.targetId, msg.client)
	const embed = new EmbedBuilder()
		.setTitle(`#${msg.channel.name} in ${msg.guild.name} is active!`)
		.setDescription(`${channelLink} has reached ${pluralize(channelSpeed.toFixed(1), 'message')} per minute in the last ${pluralize(lookback, 'message')}.`)
		.addFields(
			{ name: 'SETTINGS', value: '-----------' },
			{ name: 'Target', value: `${target === null ? 'All' : target.toString()}`, inline: true },
			{ name: 'Threshold', value: `${pluralize(threshold, 'message')} per minute`, inline: true },
			{ name: 'Cooldown', value: `${pluralize(cooldown, 'minute')}`, inline: true },
			{ name: 'Lookback', value: `${pluralize(lookback, 'message')}`, inline: true },
			{ name: 'ACTIVE CHATTERS', value: '--------------------' },
			...activeChattersFields,
		)
		.setTimestamp()
		.setColor(0xffcb4c)

	await dms.send({ embeds: [embed] })
}

const messageCache = {}

client.on(Events.MessageCreate, async msg => {
	// if the message cache doesn't exist for this channel, load it with the last 100 messages
	if (messageCache[msg.channel.id] === undefined) {
		const messages = await msg.channel.messages.fetch({ limit: 100 })
		messageCache[msg.channel.id] = Object.values(messages)
	}
	// remove the oldest message from the channel's cache and add the newest
	console.log(messageCache[msg.channel.id])
	if (!userIdsWithSettingsCache.includes(msg.author.id)) return
	const userSettings = await UserSettings.findAll({ where: { userId: msg.author.id } })
	const relevantSettings = resolveSettings(userSettings, msg)
	const defaultLookback = relevantSettings?.global?.lookback || 10
	const channelSpeed = await getChannelSpeed(msg.channel, defaultLookback)
	const threshold = relevantSettings?.global?.threshold.toFixed(1) || 'n/a'
	const messageTime = msg.createdTimestamp
	const now = moment()
	const timeDifference = moment.duration(now.diff(moment(messageTime)))
	console.log(`${msg.channel.name} in ${msg.guild.name}: ${channelSpeed.toFixed(1)} m/m (${threshold}) time difference: ${timeDifference.asMilliseconds()} ms`)
	if (!userSettings.length) return
	const settingsWithTopPriority = relevantSettings.channel || relevantSettings.guild || relevantSettings.global
	await sendNotificationIfCriteriaMet(msg, settingsWithTopPriority)
})

client.login(discordUserToken)
