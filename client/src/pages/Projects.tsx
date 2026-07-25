import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Film, FolderOpen, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function Projects() {
  const { user, loading } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: projects, isLoading, refetch } = trpc.project.list.useQuery(undefined, { enabled: !!user });
  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => {
      refetch();
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
    },
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => refetch(),
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <Scissors className="w-16 h-16 text-orange-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-white mb-4">Sign in to RuffCut</h1>
          <p className="text-gray-400 mb-6">Create and manage your video editing projects</p>
          <a href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 transition-colors">
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#0a0a0f]/95 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <span className="text-[22px] font-bold text-white tracking-tight">
                Ruff<span className="text-orange-500">Cut</span>
              </span>
            </Link>
            <span className="text-white/20">|</span>
            <span className="text-gray-400 font-medium">My Projects</span>
          </div>
          <Button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-10"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        </div>
      </header>

      {/* Create Project Form */}
      {showCreate && (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <div className="bg-[#141420] border border-white/[0.06] rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Create New Project</h3>
            <div className="space-y-4">
              <Input
                placeholder="Project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-[#0a0a0f] border-white/10 text-white placeholder:text-gray-500 h-11"
              />
              <Input
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="bg-[#0a0a0f] border-white/10 text-white placeholder:text-gray-500 h-11"
              />
              <div className="flex gap-3">
                <Button
                  onClick={() => createMutation.mutate({ name: newName, description: newDesc })}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="bg-orange-500 hover:bg-orange-600 text-white h-10 gap-2"
                >
                  {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Project
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                  className="border-white/10 text-white hover:bg-white/5 h-10"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Grid */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-[#141420] border border-white/[0.06] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Link key={project.id} href={`/editor/${project.id}`}>
                <div className="group bg-[#141420] border border-white/[0.06] rounded-xl p-6 hover:border-orange-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_40px_rgba(249,115,22,0.08)] cursor-pointer">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                      <Film className="w-6 h-6 text-orange-500" />
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      project.status === "editing" ? "bg-blue-500/10 text-blue-400" :
                      project.status === "done" ? "bg-green-500/10 text-green-400" :
                      "bg-gray-500/10 text-gray-400"
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-orange-400 transition-colors">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-sm text-gray-400 line-clamp-2">{project.description}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-3">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <FolderOpen className="w-16 h-16 text-gray-600 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-3">No projects yet</h2>
            <p className="text-gray-400 mb-6">Create your first project to start editing</p>
            <Button
              onClick={() => setShowCreate(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-11"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
