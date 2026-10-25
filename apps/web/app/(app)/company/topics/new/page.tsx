"use client";

import Link from "next/link";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { TopicForm } from "../../../../../components/TopicForm";

export default function NewTopicPage() {
  return (
    <CompanyGate>
      {(company) => (
        <main className="app-main">
          <div className="page-head">
            <Link className="text-link small" href="/company/topics">← Topics</Link>
            <span className="eyebrow" style={{ marginTop: 16 }}>New topic</span>
            <h1 className="page-title">
              Describe the <span className="hl">job</span>
            </h1>
            <p className="muted">Give it a topic and a description — or press <strong>Fill with sample</strong> to see one.</p>
          </div>
          <TopicForm company={company} />
        </main>
      )}
    </CompanyGate>
  );
}
