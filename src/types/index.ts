/**
 * 项目通用类型定义
 * 集中管理所有共享的类型接口，替代散落各处的 any
 */

// 统一从 api.ts 导出 NoteAtom 类型，消除重复定义
export type { NoteAtomNode, NoteAtomMark } from '../api';

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
