# HotBot
## Get notifications when channels become active! See who's talking with a summary of the conversation
### Parameters
- `threshold`: the number of messages per minute to trigger a notification
- `cooldown`: the number of minutes to wait before sending another notification
- `lookback`: the number of previous messages used to calculate messages per minute
- `id?`: the id of the server/channel/user to be notified of
- `users?`: the minimum number of active users required to trigger a notification
- `summary?`: the kind of summary to generate (short|long|bulleted)
### Example
`/notify threshold:1 cooldown:5 lookback:10 id:[channel_id] users:3`
### Codeflow
1. User runs the `/notify` command, `execute` runs in `commands/util/notify.js`, settings are saved in the databse
2. A `Events.MessageCreate` handler in `index.js` runs on each new message, checks the database to see if any relevant settings have been set, and sends that user a direct message notifying them if their setting's criteria have been met