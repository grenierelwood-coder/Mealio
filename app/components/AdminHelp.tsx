'use client'

import type { ReactNode } from 'react'

type HelpSection = {
  title: string
  children: ReactNode
}

type AdminHelpProps = {
  title: string
  intro: string
  sections: HelpSection[]
  warning?: string
}

export default function AdminHelp({ title, intro, sections, warning }: AdminHelpProps) {
  return (
    <details className="rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
      <summary className="cursor-pointer list-none px-5 py-4 font-black text-sky-950">
        <span className="mr-2">❓</span>{title}
        <span className="ml-2 text-xs font-semibold text-sky-700">Cliquer pour afficher l’aide</span>
      </summary>

      <div className="border-t border-sky-200 px-5 py-5 text-sm leading-6 text-slate-700">
        <p className="max-w-4xl text-slate-700">{intro}</p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {sections.map(section => (
            <section key={section.title} className="rounded-xl border border-sky-100 bg-white p-4">
              <h3 className="font-black text-slate-900">{section.title}</h3>
              <div className="mt-2">{section.children}</div>
            </section>
          ))}
        </div>

        {warning && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <b>⚠️ À retenir :</b> {warning}
          </div>
        )}
      </div>
    </details>
  )
}
