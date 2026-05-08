/**
 * Catalog of zca-js API methods exposed through the generic /api proxy.
 *
 * Each entry maps a method name to its category and the canonical doc URL on
 * https://zca-js.tdung.com. Used by the OpenAPI spec and by GET /methods.
 *
 * Source: https://zca-js.tdung.com/vi/apis/<method>.html (one page per method)
 *
 * Edit the lists here when zca-js adds or removes methods.
 */

const DOC_BASE = "https://zca-js.tdung.com/vi/apis";

export interface MethodEntry {
    name: string;
    category: string;
    docUrl: string;
}

const CATEGORIES: Record<string, string[]> = {
    Messaging: [
        "sendMessage",
        "sendByPhone",
        "sendSticker",
        "sendVoice",
        "sendVideo",
        "sendLink",
        "sendCard",
        "sendBankCard",
        "deleteMessage",
        "forwardMessage",
        "addReaction",
        "sendDeliveredEvent",
        "sendSeenEvent",
        "sendTypingEvent",
    ],
    "Friend Management": [
        "acceptFriendRequest",
        "sendFriendRequest",
        "undoFriendRequest",
        "removeFriend",
        "changeFriendAlias",
        "removeFriendAlias",
        "blockUser",
        "unblockUser",
        "getAllFriends",
        "getFriendRequestStatus",
        "getSentFriendRequest",
        "getFriendRecommendations",
        "getFriendBoardList",
    ],
    "Group Management": [
        "createGroup",
        "changeGroupName",
        "changeGroupAvatar",
        "changeGroupOwner",
        "disperseGroup",
        "leaveGroup",
        "addUserToGroup",
        "removeUserFromGroup",
        "inviteUserToGroups",
        "addGroupDeputy",
        "removeGroupDeputy",
        "getGroupInfo",
        "getGroupMembersInfo",
        "getPendingGroupMembers",
        "reviewPendingMemberRequest",
        "addGroupBlockedMember",
        "removeGroupBlockedMember",
        "getGroupBlockedMember",
        "enableGroupLink",
        "disableGroupLink",
        "getGroupLinkInfo",
        "getGroupLinkDetail",
        "joinGroupLink",
        "getGroupInviteBoxList",
        "getGroupInviteBoxInfo",
        "joinGroupInviteBox",
        "deleteGroupInviteBox",
        "updateGroupSettings",
        "getAllGroups",
    ],
    "User & Account": [
        "fetchAccountInfo",
        "getUserInfo",
        "getOwnId",
        "findUser",
        "findByPhone",
        "changeAccountAvatar",
        "updateProfile",
        "lastOnline",
    ],
    "Conversation Management": [
        "deleteChat",
        "setPinnedConversations",
        "getPinConversations",
        "setHiddenConversations",
        "getHiddenConversations",
        "resetHiddenConversPin",
        "updateHiddenConversPin",
        "getArchivedChatList",
        "setMute",
        "getMute",
        "addUnreadMark",
        "removeUnreadMark",
        "getUnreadMark",
    ],
    "Reminders & Auto-Reply": [
        "createReminder",
        "editReminder",
        "removeReminder",
        "getReminder",
        "getListReminder",
        "getReminderResponses",
        "createAutoReply",
        "updateAutoReply",
        "deleteAutoReply",
        "getAutoReplyList",
        "sendReport",
        "blockViewFeed",
    ],
    "Notes & Quick Messages": [
        "createNote",
        "editNote",
        "addQuickMessage",
        "removeQuickMessage",
        "updateQuickMessage",
        "getQuickMessageList",
    ],
    "Catalogs & Products": [
        "createCatalog",
        "updateCatalog",
        "deleteCatalog",
        "getCatalogList",
        "createProductCatalog",
        "updateProductCatalog",
        "deleteProductCatalog",
        "getProductCatalogList",
        "uploadProductPhoto",
    ],
    "Polls & Boards": [
        "createPoll",
        "addPollOptions",
        "getPollDetail",
        "lockPoll",
        "getListBoard",
    ],
    "Media & Stickers": [
        "getAvatarList",
        "reuseAvatar",
        "deleteAvatar",
        "getStickers",
        "getStickersDetail",
        "uploadAttachment",
    ],
    "Settings & Utility": [
        "updateSettings",
        "updateLang",
        "getLabels",
        "updateLabels",
        "getAutoDeleteChat",
        "updateAutoDeleteChat",
        "keepAlive",
        "getCookie",
        "getContext",
        "custom",
        "undo",
        "parseLink",
        "getQR",
        "getBizAccount",
        "getRelatedFriendGroup",
    ],
};

export const METHOD_CATALOG: MethodEntry[] = Object.entries(CATEGORIES).flatMap(
    ([category, methods]) =>
        methods.map((name) => ({
            name,
            category,
            docUrl: `${DOC_BASE}/${name}.html`,
        })),
);

export const METHOD_NAMES: string[] = METHOD_CATALOG.map((m) => m.name);

export function groupedCatalog(): Array<{ category: string; methods: MethodEntry[] }> {
    return Object.entries(CATEGORIES).map(([category, methods]) => ({
        category,
        methods: methods.map((name) => ({
            name,
            category,
            docUrl: `${DOC_BASE}/${name}.html`,
        })),
    }));
}

/**
 * Discover methods that exist on a live API instance but are not in the catalog.
 * Lets the /methods endpoint surface zca-js additions we haven't documented yet.
 */
export function diffAgainstApiInstance(api: object): {
    extra: string[];
    missing: string[];
} {
    const live = new Set<string>();
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(api) ?? {})) {
        if (key === "constructor") continue;
        const v = (api as Record<string, unknown>)[key];
        if (typeof v === "function") live.add(key);
    }
    for (const key of Object.keys(api as Record<string, unknown>)) {
        const v = (api as Record<string, unknown>)[key];
        if (typeof v === "function") live.add(key);
    }
    const known = new Set(METHOD_NAMES);
    return {
        extra: [...live].filter((m) => !known.has(m)).sort(),
        missing: METHOD_NAMES.filter((m) => !live.has(m)),
    };
}
