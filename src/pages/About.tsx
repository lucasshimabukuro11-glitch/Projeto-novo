import { PageHeading } from '../components/ui'

const technologies = ['React', 'TypeScript', 'Vite', 'Supabase', 'PostgreSQL', 'GitHub', 'Vercel']

export default function About() {
  return (
    <div className="container page about-page">
      <div className="panel about-overview">
        <PageHeading title="Sobre o EventScan">
          Plataforma web para organizar eventos, gerenciar inscrições, emitir ingressos digitais com QR Code,
          realizar check-ins e disponibilizar certificados de participação.
        </PageHeading>
      </div>
      <div className="about-grid">
        <section className="panel about-card about-author" aria-labelledby="about-author">
          <h2 id="about-author">Desenvolvedor</h2>
          <p>Lucas Shimabukuro</p>
        </section>
        <section className="panel about-card" aria-labelledby="about-technologies">
          <h2 id="about-technologies">Tecnologias</h2>
          <ul className="about-technologies" role="list">
            {technologies.map(technology => <li className="status-chip accent" key={technology}>{technology}</li>)}
          </ul>
        </section>
      </div>
    </div>
  )
}
