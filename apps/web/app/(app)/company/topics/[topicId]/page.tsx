"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CompanyGate } from "../../../../../components/CompanyGate";
import { FormError } from "../../../../../components/AuthShell";
import { TopicForm } from "../../../../../components/TopicForm";
import { companyApi } from "../../../../../lib/company";
import { useApi } from "../../../../../lib/useApi";

export default function EditTopicPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const { data: topic, error } = useApi(`/company/topics/${topicId}`, () => companyApi.topic(topicId));
  return (
    <CompanyGate>
      {(company) => (
        <main className="app-main">
          <div className="page-head">
            <Link className="text-link small" href="/company/topics">← Topics</Link>
            <span className="eyebrow" style={{ marginTop: 16 }}>Edit topic</span>
            <h1 className="page-title">{topic?.title ?? "…"}</h1>
          </div>
          <FormError message={error} />
          {topic ? <TopicForm key={topic.id} company={company} topic={topic} /> : !error && <div className="skeleton" style={{ height: 300 }} />}
        </main>
      )}
    </CompanyGate>
  );
}
