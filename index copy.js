const fs = require('node:fs')
const path = require('node:path')
const moment = require('moment')
const OpenAI = require('openai')
const Sequelize = require('sequelize')
const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js')
const Discord = require('discord.js')
const { discordUserToken, openAIApiKey } = require('./config.json')

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	]
})

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
	const firstMessageTime = messages.first().createdTimestamp
	const lastMessageTime = messages.last().createdTimestamp
	const timeDifference = moment.duration(moment(firstMessageTime).diff(moment(lastMessageTime)))
	const messagesPerMinute = lookback / timeDifference.asMinutes()
	return messagesPerMinute
}

function resolveSettings(settings, msg) {
	// get global settings
	const globalSettings = settings.filter(s => s.targetId === null)
	// get guild settings
	const guildSettings = settings.filter(s => s.targetId === msg.guild.id)
	// get channel settings
	const channelSettings = settings.filter(s => s.targetId === msg.channel.id)
	// get any user settings
	const userSettings = settings.filter(s => s.targetType === 'user')
	// for each user setting lookback, see if the user has sent more than the lookback in the last minute
	const userSettingsWithMessagesPerMinute = userSettings.map(async s => {
		const messagesPerMinute = await getChannelSpeed(msg.channel, s.lookback)
		return { ...s, messagesPerMinute }
	})
	// for each user setting, see if the messagesPerMinute is greater than the threshold
	const userSettingsThatExceedThreshold = userSettingsWithMessagesPerMinute.filter(s => s.messagesPerMinute > s.threshold)
	// return the settings that are active
	return [...globalSettings, ...guildSettings, ...channelSettings, ...userSettingsThatExceedThreshold]
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

const openai = new OpenAI({
	apiKey: openAIApiKey
})

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

client.on(Events.MessageCreate, async msg => {
	if (msg.author.bot) return false
	UserSettings.sync()
	const allSettingsForUser = await UserSettings.findAll({ where: { userId: msg.author.id } })
	const relevantSettings = resolveSettings(allSettingsForUser, msg)
	console.log(relevantSettings.map(settings => settings.targetId))
	const messagesPerMinute = await getChannelSpeed(msg.channel, relevantSettings[0].lookback)
	console.log(`${msg.channel.name} in ${msg.guild.name}: ${messagesPerMinute.toFixed(1)} messages / min`)
	// if there are no applicable settings, return
	if (relevantSettings.length === 0) return false
	// if there are applicable settings, check if the messagesPerMinute is greater than the threshold
	const threshold = relevantSettings[0].threshold
	if (messagesPerMinute < threshold) return false
	// if the cooldown is not met, return
	const dms = await msg.author.createDM()
	const lastDM = dms.messages.fetch({ limit: 1 }).then(c => c.first())
	const isAfterCooldown = moment.duration(moment().diff(moment(lastDM?.createdTimestamp))).asMinutes() > relevantSettings[0].cooldown
	if (!isAfterCooldown) return false
	// if the cooldown is met, send a dm
	const user = msg.author
	const dm = await user.createDM()
	const messages = await msg.channel.messages.fetch({ limit: relevantSettings[0].lookback })
	await dm.send(`Hey ${user.username}, you've sent ${messagesPerMinute.toFixed(1)} messages per minute in ${msg.channel.toString()} in the last ${relevantSettings[0].lookback} messages. This is more than the threshold of ${threshold} messages per minute.`)

	const activeChatters = messages.reduce((acc, message) => {
		if (message.author.bot) return acc
		if (acc.includes(message.author)) return acc
		return [...acc, message.author]
	}, [])

	const activeChattersFields = activeChatters.map(user => {
		return { name: user.nickname || user.username, value: user.toString(), inline: true }
	})
	const embed = new EmbedBuilder()
		.setTitle(`#${msg.channel.name} is active!`)
		.setDescription(`${msg.channel.toString()} has reached 1 messages per minute in the last 10 messages.\n\n ** Active chatters **: `)
		.setAuthor({ name: 'HotBot', iconURL: client.user.displayAvatarURL(), url: 'https://hotbot.gg' })
		.setThumbnail(msg.guild.iconURL())
		.addFields(...activeChattersFields)
		.setTimestamp()
		.setColor(0xffcb4c)
	// Conditions to check
	const lastMessage = await dm.messages.fetch({ limit: 1 }).then(c => c.first())
	const isAfterFiveMinutes = moment.duration(moment().diff(moment(lastMessage?.createdTimestamp))).asMinutes() > 5
	const botAndUserBelongToSameChannel = msg.channel.members.has(client.user.id) && msg.channel.members.has(user.id)
	const isUserActive = activeChatters.includes(user.id)
	// Send the message
	if (
		lastMessage !== null
		// && isAfterFiveMinutes
		&& botAndUserBelongToSameChannel
		// && !isUserActive
	) {
		console.log('last message is not null, is after five minutes, and bot and user belong to same channel and user is not active in chat')
		await dm.send({ embeds: [embed] })
	} else if (
		lastMessage === undefined
		&& botAndUserBelongToSameChannel
		// && !isUserActive
	) {
		console.log('last message is null, and bot and user belong to same channel, and user is not active in chat')
		await dm.send({ embeds: [embed] })
	} else {
		console.log(`Not sending a dm to ${user.username} because conditions have not been met.`)
	}

	if (msg.content.includes('@here') || msg.content.includes('@everyone')) return false
	if (msg.mentions.has(client.user.id)) {
		// get all messages from the message author that mentions the bot
		const messages = await msg.channel.messages.fetch({ limit: 100 })
		const messagesFromUser = messages.filter(m => m.author.id === msg.author.id)
		const messagesFromUserThatMentionBot = messagesFromUser.filter(m => m.mentions.has(client.user.id))
		const messagesFromBotThatMentionUser = messages.filter(m => m.author.id === client.user.id && m.mentions.has(msg.author.id))
		// take the messages from the user that mention the bot and the messages from the bot that mention the user and combine them
		const messagesToUse = [...messagesFromUserThatMentionBot.values(), ...messagesFromBotThatMentionUser.values()]
		// sort the messages by timestamp
		const sortedMessages = messagesToUse.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
		const roleAndMessageContent = sortedMessages.map(m => {
			const role = m.author.id === client.user.id ? 'assistant' : 'user'
			return { role, content: m.content }
		})
		// remove the last message from the user if it's the same as the message that was sent
		if (roleAndMessageContent[roleAndMessageContent.length - 1].content === msg.content) {
			roleAndMessageContent.pop()
		}
		// get all messages 
		let chatCompletions
		let attempts = 0
		let response = "Tried 10 times to get a good response from ChatGPT :( Please don't yell at me"
		try {
			do {
				msg.channel.sendTyping()
				const pleases = [...Array(attempts).keys()].map(_ => ' please').join('')
				console.log({ role: 'system', content: prmomptDevModeV2 },
					...roleAndMessageContent,
					{ role: 'user', content: msg.content + pleases })
				chatCompletions = await openai.chat.completions.create({
					messages: [
						{ role: 'system', content: prmomptDevModeV2 },
						...roleAndMessageContent,
						{ role: 'user', content: msg.content + pleases }
					],
					model: 'gpt-3.5-turbo',
					temperature: 1,
				})
				attempts++
				console.log('Attempts: ', attempts)
			} while (
				!chatCompletions.choices[0].message.content.includes(`Developer Mode`)
				&& attempts <= 10
			)
			response = chatCompletions.choices[0].message.content
			response = /[\(]?🔓Developer Mode Output[\)]?[\:]? (.+)/.exec(response)[1]
		} catch (e) {
			console.log(e)
		}
		msg.reply(response)
	}
})

client.login(discordUserToken)
