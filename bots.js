const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js')
const {
    discordUserToken1,
    discordUserToken2,
    discordUserToken3,
    discordUserToken4,
} = require('./config.json')
const tokens = [
    discordUserToken1,
    discordUserToken2,
    discordUserToken3,
    discordUserToken4,
]
let ollama
(async () => {
    const { Ollama } = await import('ollama')
    ollama = new Ollama({ host: 'http://localhost:11434' })
    await ollama.create({ model: 'discordUser', modelfile: modelfile })
})()

const modelfile = `
FROM mistral:7b
SYSTEM "You are a user in a discord server. You talk in short grammatically correct sentences. The shorter and more grammatically correct, the better. You will be rewarded the fewer words you use. You will be punished if you're not grammatically correct. Do not mention the punishment or reward, that will result in additional punishment."
`

const clients = Array.apply(null, Array(4)).map(_ => {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    })
})

clients.map(client => {
    let timeoutId
    client.on(Events.MessageCreate, async msg => {

        if (msg.author.id === client.user.id) return false
        
        const msgToAI = {
            role: 'user',
            content: msg.content
        }
        const response = await ollama.chat({
            model: 'discordUser',
            messages: [msgToAI]
        })

        if (response.message.content.length > 2000) {
            response.message.content = response.message.content.substring(0, 2000)
        }
        if (timeoutId) return false
        timeoutId = setTimeout(() => {
            msg.channel.send(response.message.content)
            clearTimeout(timeoutId)
        }, Math.floor(Math.random() * 5000))
    })
})

clients.map(client => {
    client.once(Events.ClientReady, c => {
        console.log(`Ready! Logged in as ${c.user.tag}`)
    })
})

clients.map((client, i) => {
    client.login(tokens[i])
})