export function subscribeToPostgres(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('A assinatura do PostgreSQL ainda não está ativa no Realtime.')), 12_000)
    channel.on('system', {}, ({ extension, status }) => {
      if (extension === 'postgres_changes' && status === 'ok') {
        clearTimeout(timeout)
        resolve()
      }
    }).subscribe((_status, error) => {
      if (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}
