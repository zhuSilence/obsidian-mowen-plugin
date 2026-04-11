/**
 * 项目通用类型定义
 * 集中管理所有共享的类型接口，替代散落各处的 any
 */

import { NoteAtomMark } from '../api';

/** 发布隐私设置 */
export interface PublishPrivacySettings {
	type: 'private' | 'public' | 'rule';
	rule?: {
		noShare?: boolean;
		expireAt?: number;
	};
}

/** 发布时的完整设置对象 */
export interface PublishContextSettings {
	section: number;
	privacy: PublishPrivacySettings;
	tags?: string;
	auto_publish?: boolean;
}

/** Modal onSubmit 回调的参数类型 */
export interface ModalSubmitParams {
	title: string;
	tags: string;
	autoPublish: boolean;
	settings: PublishContextSettings;
	summary: string | null;
}

/** NoteAtom 文本节点（带 marks） */
export interface NoteAtomTextNode {
	type: 'text';
	text: string;
	marks?: NoteAtomMark[];
}

/** NoteAtom 节点（通用） */
export interface NoteAtomNode {
	type: string;
	content?: NoteAtomNode[];
	text?: string;
	marks?: NoteAtomMark[];
	attrs?: Record<string, unknown>;
}
