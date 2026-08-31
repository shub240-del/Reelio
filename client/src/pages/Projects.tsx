import { ReelioLogo } from "@/components/brand/ReelioLogo";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Film,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Scissors,
  Copy,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";

function formatDate(value: Date | string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function statusClass(status: string) {
  if (status === "editing") return "bg-blue-500/10 text-blue-400";
  if (status === "done") return "bg-green-500/10 text-green-400";
  return "bg-gray-500/10 text-gray-400";
}

export default function Projects() {
  const { user, loading } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const projectsQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!user,
  });
  const projects = projectsQuery.data ?? [];
  const recentProjects = useMemo(() => projects.slice(0, 3), [projects]);

  const createMutation = trpc.project.create.useMutation({
    onSuccess: async () => {
      await projectsQuery.refetch();
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setActionError(null);
    },
    onError: error => setActionError(error.message),
  });
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: async () => {
      await projectsQuery.refetch();
      setEditingId(null);
      setActionError(null);
    },
    onError: error => setActionError(error.message),
  });
  const duplicateMutation = trpc.project.duplicate.useMutation({
    onSuccess: async () => {
      await projectsQuery.refetch();
      setActionError(null);
    },
    onError: error => setActionError(error.message),
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: async () => {
      await projectsQuery.refetch();
      setDeleteTarget(null);
      setActionError(null);
    },
    onError: error => setActionError(error.message),
  });

  const beginRename = (project: (typeof projects)[number]) => {
    setEditingId(project.id);
    setEditName(project.name);
    setEditDescription(project.description ?? "");
    setDeleteTarget(null);
    setActionError(null);
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate({ name, description: newDesc.trim() || undefined });
  };

  const submitRename = (event: FormEvent, id: number) => {
    event.preventDefault();
    const name = editName.trim();
    if (!name) return;
    updateMutation.mutate({
      id,
      name,
      description: editDescription.trim() || null,
    });
  };

  if (loading) {
    return (
      <div
        className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"
        aria-label="Loading Reelio"
      >
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <Scissors className="w-16 h-16 text-brand-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-4">
            Start editing locally
          </h1>
          <p className="text-gray-400 mb-6">
            Reelio projects are available in guest mode without OAuth or cloud
            credentials.
          </p>
          <Link href="/">
            <Button className="bg-brand-500 hover:bg-brand-600 text-white">
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="border-b border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="Reelio home">
              <ReelioLogo size={28} />
            </Link>
            <span className="text-white/20">|</span>
            <span className="hidden text-gray-400 font-medium sm:inline">
              Project Workspace
            </span>
          </div>
          <Button
            onClick={() => setShowCreate(value => !value)}
            className="bg-brand-500 hover:bg-brand-600 text-white gap-2 h-10"
          >
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex items-start justify-between gap-6 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-400 mb-2">
              Workspace
            </p>
            <h1 className="text-3xl md:text-4xl font-bold">Your projects</h1>
            <p className="text-gray-400 mt-2">
              Create, reopen, and manage your edits locally.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => projectsQuery.refetch()}
            disabled={projectsQuery.isFetching}
            className="border-white/10 text-gray-300 hover:bg-white/5 gap-2"
          >
            <RefreshCw
              className={`w-4 h-4 ${projectsQuery.isFetching ? "animate-spin" : ""}`}
            />{" "}
            Refresh
          </Button>
        </div>

        {actionError && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between"
          >
            <span>{actionError}</span>
            <button
              className="text-red-200 underline"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {showCreate && (
          <form
            onSubmit={submitCreate}
            className="mb-8 bg-[#141420] border border-brand-500/20 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold mb-4">Create New Project</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="space-y-1.5 text-xs text-gray-400">
                Project name
                <Input
                  autoFocus
                  required
                  maxLength={160}
                  placeholder="Project name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="bg-[#0a0a0f] border-white/10 text-white placeholder:text-gray-500 h-11"
                />
              </label>
              <label className="space-y-1.5 text-xs text-gray-400">
                Description (optional)
                <Input
                  maxLength={2000}
                  placeholder="What are you editing?"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="bg-[#0a0a0f] border-white/10 text-white placeholder:text-gray-500 h-11"
                />
              </label>
            </div>
            <div className="flex gap-3 mt-4">
              <Button
                type="submit"
                disabled={!newName.trim() || createMutation.isPending}
                className="bg-brand-500 hover:bg-brand-600 text-white gap-2"
              >
                {createMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}{" "}
                Create Project
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreate(false)}
                className="border-white/10 text-white hover:bg-white/5"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {projectsQuery.isLoading ? (
          <section
            aria-label="Loading projects"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {[1, 2, 3].map(item => (
              <div
                key={item}
                className="h-56 rounded-xl bg-[#141420] border border-white/[0.06] animate-pulse"
              />
            ))}
          </section>
        ) : projectsQuery.isError ? (
          <section
            role="alert"
            className="rounded-xl border border-red-400/20 bg-red-400/5 py-20 text-center"
          >
            <h2 className="text-2xl font-bold mb-3">
              Projects could not be loaded
            </h2>
            <p className="text-gray-400 mb-6">{projectsQuery.error.message}</p>
            <Button
              onClick={() => projectsQuery.refetch()}
              className="bg-brand-500 hover:bg-brand-600 text-white"
            >
              Try again
            </Button>
          </section>
        ) : projects.length === 0 ? (
          <section className="rounded-xl border border-dashed border-white/10 bg-[#101018] py-24 text-center">
            <FolderOpen className="w-16 h-16 text-gray-600 mx-auto mb-6" />
            <h2 className="text-2xl font-bold mb-3">No projects yet</h2>
            <p className="text-gray-400 mb-6">
              Create your first project to start editing.
            </p>
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-brand-500 hover:bg-brand-600 text-white gap-2 h-11"
            >
              <Plus className="w-4 h-4" /> Create Project
            </Button>
          </section>
        ) : (
          <>
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm uppercase tracking-[0.18em] text-gray-400">
                  Recent projects
                </h2>
                <span className="text-xs text-gray-500">
                  {projects.length} total
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recentProjects.map(project => (
                  <Link
                    key={`recent-${project.id}`}
                    href={`/editor/${project.id}`}
                    className="rounded-xl border border-brand-500/20 bg-brand-500/[0.06] p-4 hover:border-brand-500/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Film className="w-5 h-5 text-brand-400" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{project.name}</p>
                        <p className="text-xs text-gray-500">
                          Updated {formatDate(project.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-sm uppercase tracking-[0.18em] text-gray-400 mb-4">
                All projects
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map(project => {
                  const isEditing = editingId === project.id;
                  const isDeleting = deleteTarget === project.id;
                  return (
                    <article
                      key={project.id}
                      className="bg-[#141420] border border-white/[0.06] rounded-xl p-6 hover:border-brand-500/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-12 h-12 rounded-xl bg-brand-500/10 flex items-center justify-center">
                          <Film className="w-6 h-6 text-brand-500" />
                        </div>
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusClass(project.status)}`}
                        >
                          {project.status}
                        </span>
                      </div>
                      {isEditing ? (
                        <form
                          onSubmit={event => submitRename(event, project.id)}
                          className="space-y-3"
                        >
                          <Input
                            aria-label="Project name"
                            maxLength={160}
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="bg-[#0a0a0f] border-white/10 text-white"
                          />
                          <Input
                            aria-label="Project description"
                            maxLength={2000}
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            placeholder="Description (optional)"
                            className="bg-[#0a0a0f] border-white/10 text-white"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="submit"
                              disabled={
                                !editName.trim() || updateMutation.isPending
                              }
                              className="bg-brand-500 hover:bg-brand-600 text-white"
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                              className="border-white/10 text-white"
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <h3 className="text-lg font-semibold mb-1 truncate">
                            {project.name}
                          </h3>
                          {project.description ? (
                            <p className="text-sm text-gray-400 line-clamp-2 min-h-10">
                              {project.description}
                            </p>
                          ) : (
                            <p className="text-sm text-gray-600 min-h-10">
                              No description
                            </p>
                          )}
                          <p className="text-xs text-gray-500 mt-3">
                            Created {formatDate(project.createdAt)} · Updated{" "}
                            {formatDate(project.updatedAt)}
                          </p>
                          <div className="flex items-center gap-2 mt-5">
                            <Link href={`/editor/${project.id}`}>
                              <Button
                                size="sm"
                                className="bg-brand-500 hover:bg-brand-600 text-white"
                              >
                                Open Project
                              </Button>
                            </Link>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => beginRename(project)}
                              className="border-white/10 text-gray-300 hover:bg-white/5"
                              aria-label={`Rename ${project.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                duplicateMutation.mutate({ id: project.id })
                              }
                              disabled={duplicateMutation.isPending}
                              className="border-white/10 text-gray-300 hover:bg-white/5"
                              aria-label={`Duplicate ${project.name}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDeleteTarget(isDeleting ? null : project.id)
                              }
                              className="border-white/10 text-gray-300 hover:text-red-300 hover:bg-red-400/5"
                              aria-label={`Delete ${project.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          {isDeleting && (
                            <div
                              role="group"
                              aria-labelledby={`delete-project-${project.id}`}
                              className="mt-4 rounded-lg border border-red-400/20 bg-red-400/5 p-3"
                            >
                              <p id={`delete-project-${project.id}`} className="text-sm text-red-200 mb-3">
                                Delete this project, its timeline data, and
                                Reelio-managed media? External storage providers
                                may retain their own copies.
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    deleteMutation.mutate({ id: project.id })
                                  }
                                  disabled={deleteMutation.isPending}
                                  className="bg-red-500 hover:bg-red-600 text-white"
                                >
                                  {deleteMutation.isPending
                                    ? "Deleting…"
                                    : "Confirm delete"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setDeleteTarget(null)}
                                  className="border-white/10 text-white"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
