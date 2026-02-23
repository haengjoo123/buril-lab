import React, { useState, useEffect } from 'react';
import { X, Search, Plus, Check, Loader2, AlertCircle, Users, Settings } from 'lucide-react';
import { labService } from '../services/labService';
import { useLabStore } from '../store/useLabStore';
import type { Lab } from '../store/useLabStore';

interface LabManagementModalProps {
    onClose: () => void;
}

export const LabManagementModal: React.FC<LabManagementModalProps> = ({ onClose }) => {
    const [view, setView] = useState<'menu' | 'create' | 'search' | 'members' | 'settings'>('menu');
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Lab[]>([]);
    const [members, setMembers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createName, setCreateName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [createNickname, setCreateNickname] = useState('');

    // For joining a lab
    const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
    const [selectedRole, setSelectedRole] = useState<'researcher' | 'student'>('researcher');
    const [joinPassword, setJoinPassword] = useState('');
    const [joinNickname, setJoinNickname] = useState('');

    // For settings
    const [settingsName, setSettingsName] = useState('');
    const [settingsPassword, setSettingsPassword] = useState('');

    const { myLabs, setMyLabs, currentLabId, setCurrentLabId } = useLabStore();

    const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;

    const loadMembers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await labService.getLabMembers(currentLabId!);
            setMembers(data);
        } catch (err: any) {
            setError(err.message || '멤버 목록을 불러오지 못했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (view === 'members' && currentLabId) {
            loadMembers();
        }
    }, [view, currentLabId]);

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!currentLabId) return;
        setIsLoading(true);
        try {
            await labService.updateMemberRole(currentLabId, userId, newRole);
            await loadMembers(); // refresh
        } catch (err: any) {
            setError(err.message || "권한 변경에 실패했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveMember = async (userId: string) => {
        if (!currentLabId || !window.confirm("정말 이 사용자를 강퇴하시겠습니까? (이 작업은 되돌릴 수 없습니다.)")) return;
        setIsLoading(true);
        try {
            await labService.removeMember(currentLabId, userId);
            await loadMembers(); // refresh
        } catch (err: any) {
            setError(err.message || "맴버 강퇴에 실패했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const results = await labService.searchLabs(query);
            setSearchResults(results);
        } catch (err: any) {
            setError(err.message || "Failed to search labs");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createName.trim() || !createNickname.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const newLab = await labService.createLab(createName, createPassword, createNickname);
            // update state
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(newLab.id);
            onClose();
        } catch (err: any) {
            setError(err.message || "Failed to create lab");
        } finally {
            setIsLoading(false);
        }
    };

    const handleJoin = async () => {
        if (!selectedLabId || !joinNickname.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            await labService.joinLab(selectedLabId!, selectedRole, joinPassword, joinNickname);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(selectedLabId);
            onClose();
        } catch (err: any) {
            if (err.code === '23505') {
                setError("이미 이 연구실에 가입되어 있습니다.");
            } else {
                setError(err.message || "가입에 실패했습니다.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentLabId || !settingsName.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            await labService.updateLab(currentLabId, {
                name: settingsName,
                ...(settingsPassword ? { join_password: settingsPassword } : { join_password: '' })
            });
            // Update local state to reflect changes instantly
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            alert("연구실 설정이 저장되었습니다.");
            setView('menu');
        } catch (err: any) {
            setError(err.message || "설정 변경에 실패했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteLab = async () => {
        if (!currentLabId) return;
        const confirm1 = window.confirm(`정말 "${settingsName}" 연구실을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 모든 데이터가 삭제될 수 있습니다.`);
        if (!confirm1) return;

        const confirm2 = window.prompt(`삭제 확인을 위해 연구실 이름 "${settingsName}"을(를) 정확히 입력해주세요.`);
        if (confirm2 !== settingsName) {
            alert("연구실 이름이 일치하지 않습니다. 삭제가 취소되었습니다.");
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            await labService.deleteLab(currentLabId);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(null);
            alert("연구실이 삭제되었습니다.");
            onClose();
        } catch (err: any) {
            setError(err.message || "연구실 삭제에 실패했습니다.");
            setIsLoading(false);
        }
    };

    const openSettings = () => {
        const lab = myLabs.find(m => m.lab_id === currentLabId)?.lab as any; // Temporary cast since we didn't add join_password to Lab type globally yet.
        setSettingsName(lab?.name || '');
        setSettingsPassword(lab?.join_password || '');
        setView('settings');
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-[380px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">

                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                        {view === 'menu' && '연구실 관리'}
                        {view === 'create' && '새 연구실 만들기'}
                        {view === 'search' && '연구실 검색 / 가입'}
                        {view === 'members' && '멤버 관리'}
                        {view === 'settings' && '연구실 설정'}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-5 flex-1 overflow-y-auto">
                    {error && (
                        <div className="mb-4 flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {view === 'menu' && (
                        <div className="space-y-3">
                            {currentLabId && (
                                <button
                                    onClick={() => setView('members')}
                                    className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
                                            <Users className="w-5 h-5" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">현재 연구실 멤버 관리</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">연구실에 소속된 멤버 목록 확인 및 권한 설정</div>
                                        </div>
                                    </div>
                                </button>
                            )}
                            {currentLabId && currentRole === 'admin' && (
                                <button
                                    onClick={openSettings}
                                    className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
                                            <Settings className="w-5 h-5" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">연구실 설정</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">이름 및 가입 비밀번호 변경</div>
                                        </div>
                                    </div>
                                </button>
                            )}
                            <button
                                onClick={() => setView('search')}
                                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                                        <Search className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-semibold text-slate-800 dark:text-slate-200">기존 연구실 가입</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">연구실을 검색하고 소속으로 가입합니다.</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={() => setView('create')}
                                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                        <Plus className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-semibold text-slate-800 dark:text-slate-200">새 연구실 생성</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">새로운 그룹을 만들고 관리자가 됩니다.</div>
                                    </div>
                                </div>
                            </button>

                            <div className="mt-8">
                                <h4 className="font-semibold text-sm text-slate-500 mb-2 px-1">소속된 연구실 목록</h4>
                                {myLabs.length === 0 ? (
                                    <div className="text-sm text-slate-400 italic px-1">가입된 연구실이 없습니다.</div>
                                ) : (
                                    <ul className="space-y-2">
                                        {myLabs.map(ml => (
                                            <li key={ml.lab_id} className="flex justify-between items-center p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                                <span className="font-medium text-slate-700 dark:text-slate-200">{ml.lab?.name}</span>
                                                <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-600 dark:text-slate-400 capitalize">{ml.role}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {view === 'create' && (
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">연구실 이름</label>
                                <input
                                    type="text"
                                    value={createName}
                                    onChange={e => setCreateName(e.target.value)}
                                    placeholder="예: 생명공학 제1연구실"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">내 닉네임 / 이름</label>
                                <input
                                    type="text"
                                    value={createNickname}
                                    onChange={e => setCreateNickname(e.target.value)}
                                    placeholder="예: 홍길동"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">입장 비밀번호 (선택)</label>
                                <input
                                    type="password"
                                    value={createPassword}
                                    onChange={e => setCreatePassword(e.target.value)}
                                    placeholder="설정하지 않으면 누구나 가입할 수 있습니다."
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button type="button" onClick={() => setView('menu')} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    취소
                                </button>
                                <button type="submit" disabled={isLoading || !createName.trim() || !createNickname.trim()} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center">
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : '생성하기'}
                                </button>
                            </div>
                        </form>
                    )}

                    {view === 'search' && (
                        <div className="space-y-4">
                            <form onSubmit={handleSearch} className="relative">
                                <input
                                    type="text"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="연구실 이름 검색"
                                    className="w-full pl-10 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                />
                                <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" />
                            </form>

                            {searchResults.length > 0 && (
                                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                    {searchResults.map(lab => (
                                        <div
                                            key={lab.id}
                                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedLabId === lab.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-slate-900/50'}`}
                                            onClick={() => setSelectedLabId(lab.id)}
                                        >
                                            <div className="flex justify-between items-center">
                                                <span className="font-medium text-slate-800 dark:text-slate-200">{lab.name}</span>
                                                {selectedLabId === lab.id && <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {selectedLabId && (
                                <div className="animate-in fade-in slide-in-from-bottom-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">역할 선택</label>
                                    <div className="flex gap-2 mb-4">
                                        <label className={`flex-1 flex justify-center py-2 px-3 border rounded-lg cursor-pointer transition-colors ${selectedRole === 'researcher' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
                                            <input type="radio" className="hidden" checked={selectedRole === 'researcher'} onChange={() => setSelectedRole('researcher')} />
                                            연구원
                                        </label>
                                        <label className={`flex-1 flex justify-center py-2 px-3 border rounded-lg cursor-pointer transition-colors ${selectedRole === 'student' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
                                            <input type="radio" className="hidden" checked={selectedRole === 'student'} onChange={() => setSelectedRole('student')} />
                                            학생
                                        </label>
                                    </div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">내 닉네임 / 이름</label>
                                        <input
                                            type="text"
                                            value={joinNickname}
                                            onChange={e => setJoinNickname(e.target.value)}
                                            placeholder="예: 홍길동"
                                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                            required
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">비밀번호 (해당 시)</label>
                                        <input
                                            type="password"
                                            value={joinPassword}
                                            onChange={e => setJoinPassword(e.target.value)}
                                            placeholder="연구실 비밀번호를 입력하세요"
                                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <button
                                        onClick={handleJoin}
                                        disabled={isLoading || !joinNickname.trim()}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center"
                                    >
                                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : '가입하기'}
                                    </button>
                                </div>
                            )}

                            {searchResults.length === 0 && query && !isLoading && (
                                <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                                    검색 결과가 없습니다.
                                </div>
                            )}

                            <div className="pt-2">
                                <button type="button" onClick={() => { setView('menu'); setSelectedLabId(null); setJoinPassword(''); setJoinNickname(''); }} className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    뒤로 가기
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'members' && (
                        <div className="space-y-4">
                            {isLoading && members.length === 0 ? (
                                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
                            ) : members.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">멤버가 없습니다.</div>
                            ) : (
                                <ul className="space-y-3">
                                    {members.map(member => (
                                        <li key={member.user_id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-slate-800 dark:text-slate-200">
                                                            {member.nickname || member.email || '알 수 없는 사용자'}
                                                        </span>
                                                        {member.nickname && member.email && (
                                                            <span className="text-xs text-slate-400 dark:text-slate-500">
                                                                ({member.email})
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-slate-500 mt-0.5">가입일: {new Date(member.joined_at).toLocaleDateString()}</span>
                                                </div>
                                                <span className={`text-xs px-2 py-1 rounded font-medium ${member.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
                                                    {member.role.toUpperCase()}
                                                </span>
                                            </div>

                                            {currentRole === 'admin' && member.role !== 'admin' && ( // Admins can't demote themselves easily here to avoid 0 admins scenario
                                                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                                    <select
                                                        value={member.role}
                                                        onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                                                        disabled={isLoading}
                                                        className="text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 flex-1 text-slate-700 dark:text-slate-300"
                                                    >
                                                        <option value="researcher">연구원 (Researcher)</option>
                                                        <option value="student">학생 (Student)</option>
                                                        <option value="admin">관리자 승급 (Admin)</option>
                                                    </select>
                                                    <button
                                                        onClick={() => handleRemoveMember(member.user_id)}
                                                        disabled={isLoading}
                                                        className="text-xs px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 rounded transition-colors"
                                                    >
                                                        강퇴
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="pt-2 sticky bottom-0 bg-white dark:bg-slate-900 pb-1 -mx-1 px-1 mt-2 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={() => setView('menu')} className="w-full mt-2 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    뒤로 가기
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'settings' && (
                        <form onSubmit={handleUpdateSettings} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">연구실 이름</label>
                                <input
                                    type="text"
                                    value={settingsName}
                                    onChange={e => setSettingsName(e.target.value)}
                                    placeholder="연구실 이름"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">입장 비밀번호</label>
                                <input
                                    type="text"
                                    value={settingsPassword}
                                    onChange={e => setSettingsPassword(e.target.value)}
                                    placeholder="비밀번호 없음 (빈칸 시 누구나 가입 가능)"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    autoComplete="off"
                                />
                                <p className="text-xs text-slate-500 mt-1">이전에 설정한 비밀번호가 표시되며, 수정하실 수 있습니다.</p>
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button type="button" onClick={() => setView('menu')} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    취소
                                </button>
                                <button type="submit" disabled={isLoading || !settingsName.trim()} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center">
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : '저장하기'}
                                </button>
                            </div>

                            <div className="mt-8 pt-6 border-t border-red-100 dark:border-red-900/30">
                                <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">위험 구역 (Danger Zone)</h4>
                                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30 flex flex-col gap-3">
                                    <div className="text-sm text-red-700 dark:text-red-300">
                                        연구실을 삭제하면 모든 데이터(시약장, 시약 등) 복구가 불가능할 수 있습니다.
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDeleteLab}
                                        disabled={isLoading}
                                        className="w-full py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                        연구실 완전 삭제
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
