import type { CertificateRecord } from '../../data/expansion/types'
import { eventDate } from '../../data/domain'

async function image(url: string | null) {
  if (!url) return null
  try {
    const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null
    const file = await response.blob()
    if (file.size > 5 * 1024 * 1024) return null
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, 850 / bitmap.width, 300 / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1,Math.round(bitmap.width * scale))
      canvas.height = Math.max(1,Math.round(bitmap.height * scale))
      canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height)
      return { data: canvas.toDataURL('image/png'), ratio: bitmap.width / bitmap.height }
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

export function certificateDate(value: string) {
  return eventDate(value + 'T12:00:00-03:00')
}

export async function downloadCertificate(certificate: CertificateRecord, qr: string) {
  const { details } = certificate
  const [logo, signature, { jsPDF }] = await Promise.all([image(details.logo_url),image(details.signature_url),import('jspdf')])
  const pdf = new jsPDF({ unit: 'mm',format: 'a4',orientation: 'landscape',compress: true })
  const center = 148.5

  pdf.setProperties({ title: 'Certificado EventScan',author: details.organizer_name,subject: details.event_name })
  pdf.setFillColor('#f9f7ff').rect(0,0,297,210,'F')
  pdf.setFillColor('#1a1330').rect(0,0,297,26,'F')
  pdf.setDrawColor('#a88bf2').setLineWidth(0.5).rect(9,9,279,192)
  pdf.setDrawColor('#ded4f7').setLineWidth(0.3).rect(12,12,273,186)
  pdf.setFont('helvetica','bold').setFontSize(13).setTextColor('#f7f1ff').text('EventScan',20,19)

  if (logo) {
    const width = Math.min(42,14 * logo.ratio)
    pdf.addImage(logo.data,'PNG',273-width,11,width,width/logo.ratio,'logo','FAST')
  }

  pdf.setFontSize(12).setTextColor('#6d45ba').text('CERTIFICADO DE PARTICIPAÇÃO',center,42,{ align: 'center' })
  pdf.setFont('helvetica','normal').setFontSize(12).setTextColor('#4a4359').text('Certificamos a participação de',center,55,{ align: 'center' })
  pdf.setFont('helvetica','bold').setTextColor('#1a1330').setFontSize(28)
  const nameLines: string[] = pdf.splitTextToSize(details.participant_name,246)
  pdf.text(nameLines,center,69,{ align: 'center' })
  const eventY = nameLines.length > 1 ? 91 : 84
  pdf.setFontSize(17).setTextColor('#442880')
  const eventLines: string[] = pdf.splitTextToSize(details.event_name,225)
  pdf.text(eventLines,center,eventY,{ align: 'center' })
  pdf.setFont('helvetica','normal').setFontSize(11.25).setTextColor('#3c324d')
  const y = eventY + eventLines.length * 7
  pdf.text(`${certificateDate(details.event_date)}  •  ${details.hours.toLocaleString('pt-BR')} h`,center,y,{ align: 'center' })
  pdf.text(pdf.splitTextToSize(details.participation_text,201),center,y + 10,{ align: 'center' })

  if (signature) {
    const width = Math.min(54,16 * signature.ratio)
    pdf.addImage(signature.data,'PNG',center-width/2,147,width,width/signature.ratio,'signature','FAST')
  }
  pdf.setDrawColor('#cfc1e7').line(104,165,193,165)
  pdf.setFont('helvetica','bold').setFontSize(11).setTextColor('#1a1330')
  pdf.text(pdf.splitTextToSize(details.organizer_name,149),center,171,{ align: 'center' })
  pdf.addImage(qr,'PNG',244,145,31,31,'verification','FAST')
  pdf.setFont('helvetica','normal').setFontSize(8).setTextColor('#504365')
  pdf.text('Verificação online',259.5,180,{ align: 'center' })
  pdf.text(`Emitido em ${eventDate(certificate.issued_at)}`,20,186)
  pdf.text(`Código de autenticidade  ${certificate.code}`,20,192)
  pdf.save('eventscan-certificado-' + certificate.code.slice(0,8) + '.pdf')
  return Boolean((details.logo_url && !logo) || (details.signature_url && !signature))
}
