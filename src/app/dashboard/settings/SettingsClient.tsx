"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Search,
  Menu,
  Loader2,
  ArrowLeft,
  User,
  Lock,
  Shield,
  Mail,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  LogOut as LogOutIcon,
  Calendar,
  Eye,
  EyeOff,
  Plus,
  Briefcase,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import DashboardSidebar from "@/components/dashboard-sidebar";
import NewWorkspaceModal from "@/components/new-workspace-modal";
import ArchiveWorkspaceDialog from "@/components/archive-workspace-dialog";
import type { Workspace, WorkspaceWithMeta } from "@/lib/workspaces";
import { formatActiveCount } from "@/lib/format-arabic";
import { deleteAccountAction } from "./actions";
import { setWorkspaceAsDefault } from "./workspaces/actions";

interface SettingsClientProps {
  fullName: string;
  companyName: string;
  email: string;
  lastSignInAt: string | null;
  workspaces: Workspace[];
  activeWorkspaceId: number;
  workspacesWithCounts: WorkspaceWithMeta[];
}

type TabId = "profile" | "password" | "security";

export default function SettingsClient({
  fullName,
  companyName,
  email,
  lastSignInAt,
  workspaces,
  activeWorkspaceId,
  workspacesWithCounts,
}: SettingsClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  // Workspaces section — setDefault action state. Tracks which workspace
  // row is currently pending so only that row shows its spinner.
  const [isSetDefaultPending, startSetDefaultTransition] = useTransition();
  const [pendingSetDefaultId, setPendingSetDefaultId] = useState<number | null>(
    null
  );
  const [workspaceActionError, setWorkspaceActionError] = useState<
    string | null
  >(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [workspaceToArchive, setWorkspaceToArchive] =
    useState<Workspace | null>(null);

  const handleSetDefault = (id: number) => {
    setWorkspaceActionError(null);
    setPendingSetDefaultId(id);
    startSetDefaultTransition(async () => {
      const result = await setWorkspaceAsDefault(id);
      setPendingSetDefaultId(null);
      if ("error" in result) {
        setWorkspaceActionError(result.error);
      }
    });
  };

  // Profile tab state
  const [profileForm, setProfileForm] = useState({
    fullName,
    companyName,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Password tab state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Security tab state
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const initial = fullName.charAt(0).toUpperCase();

  // Tabs
  const tabs: { id: TabId; label: string; icon: typeof User }[] = [
    { id: "profile", label: "البيانات الشخصية", icon: User },
    { id: "password", label: "تغيير كلمة السر", icon: Lock },
    { id: "security", label: "الأمان", icon: Shield },
  ];

  // Profile: save personal info
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileSaving(true);

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: profileForm.fullName.trim(),
        company_name: profileForm.companyName.trim(),
      },
    });

    setProfileSaving(false);

    if (error) {
      setProfileMessage({ type: "error", text: error.message });
      return;
    }

    setProfileMessage({ type: "success", text: "تم حفظ التعديلات بنجاح" });
    router.refresh();
  };

  // Password: verify current then update
  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (passwordForm.newPassword.length < 8) {
      setPasswordMessage({
        type: "error",
        text: "كلمة السر الجديدة يجب أن تكون 8 أحرف على الأقل",
      });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({
        type: "error",
        text: "كلمتا السر الجديدتان غير متطابقتين",
      });
      return;
    }

    if (passwordForm.currentPassword === passwordForm.newPassword) {
      setPasswordMessage({
        type: "error",
        text: "كلمة السر الجديدة يجب أن تكون مختلفة عن الحالية",
      });
      return;
    }

    setPasswordSaving(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: passwordForm.currentPassword,
    });

    if (signInError) {
      setPasswordSaving(false);
      setPasswordMessage({
        type: "error",
        text: "كلمة السر الحالية غير صحيحة",
      });
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: passwordForm.newPassword,
    });

    setPasswordSaving(false);

    if (updateError) {
      setPasswordMessage({ type: "error", text: updateError.message });
      return;
    }

    setPasswordMessage({
      type: "success",
      text: "تم تحديث كلمة السر بنجاح",
    });
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  };

  // Security: sign out from all devices
  const handleSignOutAll = async () => {
    setSecurityMessage(null);
    setSigningOutAll(true);

    const { error } = await supabase.auth.signOut({ scope: "global" });

    if (error) {
      setSigningOutAll(false);
      setSecurityMessage({ type: "error", text: error.message });
      return;
    }

    router.push("/login");
    router.refresh();
  };

  // Security: delete account
  const handleDeleteAccount = async () => {
    setDeleteError(null);
    setDeleting(true);

    // On success the server action calls redirect("/login"), so the framework
    // handles navigation and the await never resolves with success here. Only
    // the failure branch is reachable in client code.
    const result = await deleteAccountAction();

    if (!result.success) {
      setDeleting(false);
      setDeleteError(result.error || "حدث خطأ غير متوقع");
    }
  };

  // Format last sign-in date in Arabic
  const formattedLastSignIn = lastSignInAt
    ? new Date(lastSignInAt).toLocaleString("ar-SA", {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "غير متوفر";

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <DashboardSidebar
        fullName={fullName}
        email={email}
        activeRoute="/dashboard/settings"
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />

      {/* Main Content */}
      <div className="lg:mr-64">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div className="hidden md:flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 w-64">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="بحث..."
                  className="bg-transparent border-none outline-none text-sm w-full"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="relative p-2 hover:bg-gray-50 rounded-lg transition">
                <Bell className="w-5 h-5 text-gray-600" />
                <span className="absolute top-1.5 left-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
              </button>
              <div className="lg:hidden w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                {initial}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/dashboard"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              العودة للرئيسية
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              إعدادات الحساب
            </h1>
            <p className="text-gray-600">
              قم بإدارة معلومات حسابك وإعدادات الأمان
            </p>
          </div>

          {/* Workspaces section */}
          <div className="bg-white border border-gray-100 rounded-xl mb-8 overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900">Workspaces</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    افصل بياناتك حسب العميل أو العلامة التجارية
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewWorkspaceOpen(true)}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg transition flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
                workspace جديد
              </button>
            </div>

            {workspaceActionError && (
              <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm">
                {workspaceActionError}
              </div>
            )}

            <ul className="divide-y divide-gray-100">
              {workspacesWithCounts.map((w) => {
                const isPending =
                  isSetDefaultPending && pendingSetDefaultId === w.id;
                return (
                  <li
                    key={w.id}
                    className="flex items-center gap-4 px-6 py-4 flex-wrap"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-700 rounded-lg flex items-center justify-center font-bold flex-shrink-0">
                      {w.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {w.name}
                        </h3>
                        {w.is_default && (
                          <span className="bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-0.5 rounded">
                            افتراضي
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatActiveCount(w.activeConnections)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Link
                        href={`/dashboard/settings/workspaces/${w.id}/edit`}
                        className="text-sm text-gray-600 hover:text-indigo-600 px-3 py-1.5 rounded hover:bg-gray-50 transition"
                      >
                        إعادة تسمية
                      </Link>
                      {!w.is_default && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(w.id)}
                          disabled={isPending}
                          className="text-sm text-gray-600 hover:text-indigo-600 px-3 py-1.5 rounded hover:bg-gray-50 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {isPending && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          تعيين كافتراضي
                        </button>
                      )}
                      {!w.is_default && (
                        <button
                          type="button"
                          onClick={() => setWorkspaceToArchive(w)}
                          className="text-sm text-red-600 hover:text-red-700 px-3 py-1.5 rounded hover:bg-red-50 transition"
                        >
                          أرشفة
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Tabs */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="border-b border-gray-100 overflow-x-auto">
              <div className="flex gap-1 p-2 min-w-max">
                {tabs.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
                        isActive
                          ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tab Content */}
            <div className="p-6 md:p-8">
              {activeTab === "profile" && (
                <form onSubmit={handleProfileSave} className="max-w-2xl space-y-6">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      البيانات الشخصية
                    </h2>
                    <p className="text-sm text-gray-500">
                      حدّث اسمك واسم شركتك. سيظهر هذا في حسابك وتقاريرك.
                    </p>
                  </div>

                  {profileMessage && (
                    <div
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium border ${
                        profileMessage.type === "success"
                          ? "bg-green-50 border-green-200 text-green-700"
                          : "bg-red-50 border-red-200 text-red-700"
                      }`}
                    >
                      {profileMessage.type === "success" ? (
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      )}
                      {profileMessage.text}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      الاسم الكامل
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={profileForm.fullName}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            fullName: e.target.value,
                          })
                        }
                        className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                        placeholder="مثال: أحمد محمد"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      اسم الشركة
                    </label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={profileForm.companyName}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            companyName: e.target.value,
                          })
                        }
                        className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                        placeholder="اسم متجرك أو شركتك (اختياري)"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      البريد الإلكتروني
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        readOnly
                        value={email}
                        dir="ltr"
                        className="w-full pr-10 pl-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600 cursor-not-allowed text-left"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      البريد الإلكتروني لا يمكن تعديله. للحاجة الماسة، تواصل مع
                      الدعم الفني.
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center gap-2 disabled:opacity-70"
                    >
                      {profileSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          جاري الحفظ...
                        </>
                      ) : (
                        "حفظ التعديلات"
                      )}
                    </button>
                  </div>
                </form>
              )}

              {activeTab === "password" && (
                <form
                  onSubmit={handlePasswordSave}
                  className="max-w-2xl space-y-6"
                >
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      تغيير كلمة السر
                    </h2>
                    <p className="text-sm text-gray-500">
                      اختر كلمة سر قوية لا تستخدمها في حسابات أخرى.
                    </p>
                  </div>

                  {passwordMessage && (
                    <div
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium border ${
                        passwordMessage.type === "success"
                          ? "bg-green-50 border-green-200 text-green-700"
                          : "bg-red-50 border-red-200 text-red-700"
                      }`}
                    >
                      {passwordMessage.type === "success" ? (
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      )}
                      {passwordMessage.text}
                    </div>
                  )}

                  <PasswordInput
                    label="كلمة السر الحالية"
                    value={passwordForm.currentPassword}
                    onChange={(v) =>
                      setPasswordForm({
                        ...passwordForm,
                        currentPassword: v,
                      })
                    }
                    show={showPasswords.current}
                    onToggle={() =>
                      setShowPasswords({
                        ...showPasswords,
                        current: !showPasswords.current,
                      })
                    }
                    placeholder="••••••••"
                  />

                  <PasswordInput
                    label="كلمة السر الجديدة"
                    value={passwordForm.newPassword}
                    onChange={(v) =>
                      setPasswordForm({
                        ...passwordForm,
                        newPassword: v,
                      })
                    }
                    show={showPasswords.next}
                    onToggle={() =>
                      setShowPasswords({
                        ...showPasswords,
                        next: !showPasswords.next,
                      })
                    }
                    placeholder="8 أحرف على الأقل"
                    helperText="استخدم 8 أحرف أو أكثر، ويُفضّل خليط من حروف وأرقام ورموز."
                  />

                  <PasswordInput
                    label="تأكيد كلمة السر الجديدة"
                    value={passwordForm.confirmPassword}
                    onChange={(v) =>
                      setPasswordForm({
                        ...passwordForm,
                        confirmPassword: v,
                      })
                    }
                    show={showPasswords.confirm}
                    onToggle={() =>
                      setShowPasswords({
                        ...showPasswords,
                        confirm: !showPasswords.confirm,
                      })
                    }
                    placeholder="أعد إدخال كلمة السر الجديدة"
                  />

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={passwordSaving}
                      className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:shadow-lg hover:shadow-indigo-500/30 transition flex items-center gap-2 disabled:opacity-70"
                    >
                      {passwordSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          جاري التحديث...
                        </>
                      ) : (
                        "تحديث كلمة السر"
                      )}
                    </button>
                  </div>
                </form>
              )}

              {activeTab === "security" && (
                <div className="max-w-2xl space-y-6">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      الأمان
                    </h2>
                    <p className="text-sm text-gray-500">
                      راقب نشاط حسابك وتحكم في جلساتك.
                    </p>
                  </div>

                  {securityMessage && (
                    <div
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium border ${
                        securityMessage.type === "success"
                          ? "bg-green-50 border-green-200 text-green-700"
                          : "bg-red-50 border-red-200 text-red-700"
                      }`}
                    >
                      {securityMessage.type === "success" ? (
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      )}
                      {securityMessage.text}
                    </div>
                  )}

                  {/* Last sign in */}
                  <div className="border border-gray-100 rounded-xl p-5 bg-gray-50/50">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Calendar className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          آخر تسجيل دخول
                        </h3>
                        <p className="text-sm text-gray-600">
                          {formattedLastSignIn}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Sign out from all devices */}
                  <div className="border border-gray-100 rounded-xl p-5">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <LogOutIcon className="w-5 h-5 text-amber-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          تسجيل الخروج من جميع الأجهزة
                        </h3>
                        <p className="text-sm text-gray-600">
                          سيتم إنهاء جميع جلسات حسابك على كل المتصفحات
                          والأجهزة، وستحتاج لتسجيل الدخول من جديد.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleSignOutAll}
                      disabled={signingOutAll}
                      className="bg-amber-50 text-amber-700 border border-amber-200 px-5 py-2 rounded-lg font-semibold text-sm hover:bg-amber-100 transition flex items-center gap-2 disabled:opacity-70"
                    >
                      {signingOutAll ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          جاري الخروج...
                        </>
                      ) : (
                        <>
                          <LogOutIcon className="w-4 h-4" />
                          تسجيل الخروج من كل الأجهزة
                        </>
                      )}
                    </button>
                  </div>

                  {/* Delete account */}
                  <div className="border border-red-200 bg-red-50/40 rounded-xl p-5">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Trash2 className="w-5 h-5 text-red-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          حذف الحساب
                        </h3>
                        <p className="text-sm text-gray-600">
                          سيتم حذف حسابك وكل بياناتك بشكل نهائي. لا يمكن التراجع
                          عن هذه العملية.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(true);
                        setDeleteConfirmText("");
                        setDeleteError(null);
                      }}
                      className="bg-red-600 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-red-700 transition flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      حذف الحساب نهائياً
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Delete account confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 mb-1">
                  تأكيد حذف الحساب
                </h3>
                <p className="text-sm text-gray-600">
                  هذه عملية نهائية ولا يمكن التراجع عنها. سيتم حذف حسابك
                  وبياناتك وروابطك مع المنصات.
                </p>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                للتأكيد، اكتب{" "}
                <span className="font-bold text-red-600">حذف</span> في الحقل
                التالي:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                disabled={deleting}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition disabled:opacity-50"
                placeholder="حذف"
              />
            </div>

            {deleteError && (
              <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText !== "حذف"}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري الحذف...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    حذف الحساب
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <NewWorkspaceModal
        open={newWorkspaceOpen}
        onClose={() => setNewWorkspaceOpen(false)}
      />

      <ArchiveWorkspaceDialog
        key={workspaceToArchive?.id ?? "closed"}
        open={!!workspaceToArchive}
        onClose={() => setWorkspaceToArchive(null)}
        workspace={workspaceToArchive}
        activeConnectionsCount={
          workspaceToArchive
            ? workspacesWithCounts.find((w) => w.id === workspaceToArchive.id)
                ?.activeConnections ?? 0
            : 0
        }
      />
    </div>
  );
}

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  helperText?: string;
}

function PasswordInput({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  helperText,
}: PasswordInputProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {label}
      </label>
      <div className="relative">
        <Lock className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pr-10 pl-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
          tabIndex={-1}
        >
          {show ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
      </div>
      {helperText && (
        <p className="text-xs text-gray-500 mt-1.5">{helperText}</p>
      )}
    </div>
  );
}
