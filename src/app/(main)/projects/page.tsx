import { redirect } from 'next/navigation';

interface ProjectsAliasPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function ProjectsAliasPage({ searchParams = {} }: ProjectsAliasPageProps) {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
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

