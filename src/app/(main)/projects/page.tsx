import { redirect } from 'next/navigation';

interface ProjectsAliasPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectsAliasPage({ searchParams }: ProjectsAliasPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      params.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    }
  });

  const query = params.toString();
  redirect(query ? `/projetos?${query}` : '/projetos');
}
