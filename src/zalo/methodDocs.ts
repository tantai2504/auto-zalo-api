import { groupedCatalog, METHOD_CATALOG } from "./methodCatalog.js";
import { loadSignatures } from "./parseSignatures.js";

/**
 * Hand-written Vietnamese description + practical examples for the most-used
 * zca-js methods. Methods not listed here still appear in the catalog with
 * their parsed signature only — the explorer UI gracefully falls back.
 *
 * Example `args` arrays match the order the underlying method expects, so they
 * can be POSTed directly to /api/{accountId}/{method}.
 */
interface MethodDoc {
    description: string;
    notes?: string;
    examples?: Array<{ summary: string; args: unknown[] }>;
}

const DOCS: Record<string, MethodDoc> = {
    // ---------- Messaging --------------------------------------------------
    sendMessage: {
        description:
            "Gửi tin nhắn (text hoặc rich content) tới user hoặc group. " +
            "Type: 0 = User (1-1), 1 = Group.",
        examples: [
            {
                summary: "Tin text đơn giản tới user",
                args: [{ msg: "Xin chào" }, "<userId>", 0],
            },
            {
                summary: "Tin với mention tới group",
                args: [
                    {
                        msg: "@user xem nhé",
                        mentions: [{ pos: 0, uid: "<userId>", len: 5 }],
                    },
                    "<groupId>",
                    1,
                ],
            },
        ],
    },
    sendSticker: {
        description: "Gửi sticker tới thread.",
        examples: [
            {
                summary: "Gửi sticker theo id",
                args: [{ id: 4524, cateId: 109, type: 1 }, "<threadId>", 0],
            },
        ],
    },
    sendVoice: {
        description: "Gửi voice message từ một URL/buffer.",
    },
    sendVideo: {
        description: "Gửi video tới thread.",
    },
    sendLink: {
        description:
            "Gửi link kèm preview thumbnail. zca-js sẽ parse meta tag tự động.",
        examples: [
            {
                summary: "Share link",
                args: [{ link: "https://google.com" }, "<threadId>", 0],
            },
        ],
    },
    sendCard: {
        description: "Chia sẻ danh thiếp (thông tin user) tới thread.",
        examples: [
            { summary: "Share contact", args: ["<userIdToShare>", "<threadId>", 0] },
        ],
    },
    sendBankCard: { description: "Gửi thẻ ngân hàng (số tài khoản kèm logo bank)." },
    deleteMessage: {
        description:
            "Xoá tin nhắn. `onlyMe = true` xoá ở phía mình; `false` thu hồi cho cả 2 bên.",
    },
    forwardMessage: {
        description: "Chuyển tiếp 1 tin nhắn tới nhiều thread.",
    },
    addReaction: {
        description: "Thả emoji reaction lên tin nhắn.",
        examples: [
            {
                summary: "Reaction 'haha'",
                args: [
                    "Reactions.HAHA",
                    {
                        threadId: "<threadId>",
                        type: 0,
                        msgId: "<msgId>",
                        cliMsgId: "<cliMsgId>",
                    },
                ],
            },
        ],
        notes:
            "Thay 'Reactions.HAHA' bằng giá trị emoji string thực tế (xem enum Reactions).",
    },
    sendTypingEvent: {
        description: "Phát event 'đang nhập...' cho thread.",
        examples: [{ summary: "Typing tới user", args: ["<threadId>", 0] }],
    },
    sendSeenEvent: { description: "Đánh dấu tin nhắn là đã xem." },
    sendDeliveredEvent: { description: "Đánh dấu tin nhắn là đã giao." },

    // ---------- Friends ----------------------------------------------------
    getAllFriends: {
        description: "Lấy danh sách bạn bè. Có thể phân trang.",
        examples: [
            { summary: "Lấy 100 bạn đầu tiên", args: [100, 1] },
            { summary: "Lấy tất cả (mặc định)", args: [] },
        ],
    },
    sendFriendRequest: {
        description: "Gửi lời mời kết bạn kèm message.",
        examples: [
            {
                summary: "Mời kết bạn",
                args: ["Xin chào, kết bạn nhé!", "<userId>"],
            },
        ],
    },
    acceptFriendRequest: {
        description: "Chấp nhận lời mời kết bạn.",
        examples: [{ summary: "Accept", args: ["<userId>"] }],
    },
    undoFriendRequest: { description: "Huỷ lời mời kết bạn đã gửi." },
    removeFriend: {
        description: "Huỷ kết bạn (xoá khỏi friend list).",
        examples: [{ summary: "Unfriend", args: ["<userId>"] }],
    },
    changeFriendAlias: {
        description: "Đặt biệt danh (alias) cho bạn.",
        examples: [
            {
                summary: "Đặt alias",
                args: ["Tên gợi nhớ", "<userId>"],
            },
        ],
    },
    removeFriendAlias: { description: "Xoá alias đã đặt cho bạn." },
    blockUser: {
        description: "Chặn user.",
        examples: [{ summary: "Block", args: ["<userId>"] }],
    },
    unblockUser: {
        description: "Bỏ chặn user.",
        examples: [{ summary: "Unblock", args: ["<userId>"] }],
    },
    getFriendRequestStatus: { description: "Trạng thái lời mời kết bạn đã gửi." },
    getSentFriendRequest: { description: "Danh sách lời mời kết bạn đã gửi đi." },
    getFriendRecommendations: { description: "Danh sách gợi ý kết bạn." },
    getFriendBoardList: { description: "Danh sách bảng (board) của bạn bè." },

    // ---------- User & Account --------------------------------------------
    fetchAccountInfo: {
        description:
            "Lấy thông tin tài khoản đang đăng nhập. Trả về `{ profile, biz }` " +
            "với profile.userId, displayName, phoneNumber, avatar, ...",
        examples: [{ summary: "Lấy info", args: [] }],
    },
    getUserInfo: {
        description: "Lấy thông tin user theo uid (hoặc mảng uid).",
        examples: [
            { summary: "Một user", args: ["<userId>"] },
            { summary: "Nhiều user", args: [["<uid1>", "<uid2>"]] },
        ],
    },
    getOwnId: {
        description: "Lấy uid của tài khoản đang đăng nhập.",
        examples: [{ summary: "Get own id", args: [] }],
    },
    findUser: {
        description: "Tìm user theo số điện thoại.",
        examples: [{ summary: "Tìm SĐT", args: ["+84..."] }],
    },
    findUserByUsername: { description: "Tìm user theo username (@xxx)." },
    updateProfile: {
        description: "Cập nhật profile (tên hiển thị, dob, gender, ...).",
        examples: [
            {
                summary: "Đổi tên hiển thị",
                args: [{ name: "Tên mới" }],
            },
        ],
    },
    changeAccountAvatar: {
        description: "Đổi avatar tài khoản (đường dẫn file).",
    },
    lastOnline: { description: "Lấy thời gian online cuối cùng của user." },

    // ---------- Groups -----------------------------------------------------
    createGroup: {
        description: "Tạo group chat mới với danh sách thành viên.",
        examples: [
            {
                summary: "Tạo group",
                args: [
                    {
                        name: "Tên nhóm",
                        members: ["<uid1>", "<uid2>"],
                    },
                ],
            },
        ],
    },
    getAllGroups: {
        description: "Danh sách groupId mà tài khoản đang tham gia.",
        examples: [{ summary: "List groups", args: [] }],
    },
    getGroupInfo: {
        description: "Lấy chi tiết group theo groupId (hoặc mảng).",
        examples: [{ summary: "Lấy 1 group", args: ["<groupId>"] }],
    },
    getGroupMembersInfo: {
        description: "Lấy thông tin chi tiết các thành viên trong group.",
        examples: [
            {
                summary: "Lấy theo uid",
                args: [["<uid1>", "<uid2>"], "<groupId>"],
            },
        ],
    },
    addUserToGroup: {
        description: "Thêm user(s) vào group.",
        examples: [
            {
                summary: "Thêm 1 người",
                args: ["<userId>", "<groupId>"],
            },
            {
                summary: "Thêm nhiều người",
                args: [["<uid1>", "<uid2>"], "<groupId>"],
            },
        ],
    },
    removeUserFromGroup: {
        description: "Xoá user khỏi group (cần quyền admin/owner).",
        examples: [
            {
                summary: "Đuổi 1 user",
                args: ["<userId>", "<groupId>"],
            },
        ],
    },
    inviteUserToGroups: { description: "Mời 1 user vào nhiều group cùng lúc." },
    addGroupDeputy: { description: "Phong phó nhóm." },
    removeGroupDeputy: { description: "Gỡ phó nhóm." },
    changeGroupName: {
        description: "Đổi tên group.",
        examples: [
            {
                summary: "Đổi tên",
                args: ["Tên mới", "<groupId>"],
            },
        ],
    },
    changeGroupAvatar: { description: "Đổi avatar nhóm." },
    changeGroupOwner: { description: "Chuyển quyền chủ nhóm sang user khác." },
    disperseGroup: { description: "Giải tán nhóm (chỉ owner)." },
    leaveGroup: {
        description: "Rời nhóm.",
        examples: [{ summary: "Leave", args: ["<groupId>"] }],
    },
    getPendingGroupMembers: { description: "Danh sách yêu cầu vào nhóm chờ duyệt." },
    reviewPendingMemberRequest: {
        description: "Duyệt/từ chối yêu cầu vào nhóm.",
    },
    addGroupBlockedMember: { description: "Chặn member trong group." },
    removeGroupBlockedMember: { description: "Bỏ chặn member trong group." },
    getGroupBlockedMember: { description: "Danh sách member bị chặn trong group." },
    enableGroupLink: { description: "Bật link mời tham gia nhóm." },
    disableGroupLink: { description: "Tắt link mời nhóm." },
    getGroupLinkInfo: { description: "Thông tin link mời của nhóm." },
    getGroupLinkDetail: { description: "Chi tiết link nhóm (xem trước khi join)." },
    joinGroupLink: {
        description: "Vào group bằng link mời.",
        examples: [
            { summary: "Join via link", args: ["https://zalo.me/g/..."] },
        ],
    },
    getGroupInviteBoxList: { description: "Danh sách lời mời vào group." },
    getGroupInviteBoxInfo: { description: "Chi tiết 1 lời mời vào group." },
    joinGroupInviteBox: { description: "Chấp nhận lời mời vào group." },
    deleteGroupInviteBox: { description: "Xoá lời mời vào group." },
    updateGroupSettings: { description: "Cập nhật cài đặt group (ai được nhắn, ...)." },

    // ---------- Conversation ----------------------------------------------
    deleteChat: { description: "Xoá toàn bộ lịch sử chat của 1 thread." },
    setPinnedConversations: { description: "Ghim/bỏ ghim cuộc trò chuyện." },
    getPinConversations: { description: "Danh sách thread đã ghim." },
    setHiddenConversations: { description: "Ẩn cuộc trò chuyện (cần PIN)." },
    getHiddenConversations: { description: "Danh sách thread đã ẩn." },
    resetHiddenConversPin: { description: "Đặt lại PIN ẩn." },
    updateHiddenConversPin: { description: "Đổi PIN ẩn." },
    getArchivedChatList: { description: "Danh sách thread đã lưu trữ." },
    setMute: {
        description: "Tắt thông báo cho 1 thread (mute).",
        examples: [
            {
                summary: "Mute 1 giờ",
                args: [{ threadId: "<threadId>", type: 0, duration: 3600 }],
            },
        ],
    },
    getMute: { description: "Danh sách thread đang bị mute." },
    addUnreadMark: { description: "Đánh dấu tin nhắn là chưa đọc." },
    removeUnreadMark: { description: "Bỏ dấu chưa đọc." },
    getUnreadMark: { description: "Danh sách thread đang đánh dấu chưa đọc." },

    // ---------- Reminders / AutoReply -------------------------------------
    createReminder: { description: "Tạo nhắc nhở trong cuộc trò chuyện." },
    editReminder: { description: "Sửa nhắc nhở." },
    removeReminder: { description: "Xoá nhắc nhở." },
    getReminder: { description: "Lấy chi tiết 1 reminder." },
    getListReminder: { description: "Danh sách reminder." },
    getReminderResponses: { description: "Phản hồi (RSVP) của reminder." },
    createAutoReply: { description: "Tạo auto-reply rule." },
    updateAutoReply: { description: "Cập nhật auto-reply." },
    deleteAutoReply: { description: "Xoá auto-reply." },
    getAutoReplyList: { description: "Danh sách auto-reply." },
    sendReport: { description: "Gửi báo cáo (report) tin nhắn/user." },
    blockViewFeed: { description: "Chặn user xem feed." },

    // ---------- Notes / Quick messages ------------------------------------
    createNote: { description: "Ghim ghi chú trong group/conversation." },
    editNote: { description: "Sửa note." },
    addQuickMessage: { description: "Thêm tin nhắn nhanh (template reply)." },
    removeQuickMessage: { description: "Xoá quick message." },
    updateQuickMessage: { description: "Sửa quick message." },
    getQuickMessageList: { description: "Danh sách quick message." },

    // ---------- Catalog / Product (zBusiness) -----------------------------
    createCatalog: { description: "Tạo catalog (zBusiness)." },
    updateCatalog: { description: "Cập nhật catalog." },
    deleteCatalog: { description: "Xoá catalog." },
    getCatalogList: { description: "Danh sách catalog." },
    createProductCatalog: { description: "Thêm sản phẩm vào catalog." },
    updateProductCatalog: { description: "Sửa sản phẩm." },
    deleteProductCatalog: { description: "Xoá sản phẩm khỏi catalog." },
    getProductCatalogList: { description: "Danh sách sản phẩm trong catalog." },
    uploadProductPhoto: { description: "Upload ảnh sản phẩm." },

    // ---------- Polls -----------------------------------------------------
    createPoll: { description: "Tạo bình chọn trong group." },
    addPollOptions: { description: "Thêm option vào poll." },
    getPollDetail: { description: "Chi tiết poll + ai vote gì." },
    lockPoll: { description: "Khoá poll (không vote thêm được)." },
    getListBoard: { description: "Danh sách board (bảng tin trong group)." },

    // ---------- Media -----------------------------------------------------
    getAvatarList: { description: "Danh sách avatar đã upload." },
    reuseAvatar: { description: "Dùng lại avatar đã upload." },
    deleteAvatar: { description: "Xoá avatar đã upload." },
    getStickers: {
        description: "Tìm sticker theo từ khoá.",
        examples: [{ summary: "Search 'haha'", args: ["haha"] }],
    },
    getStickersDetail: { description: "Chi tiết bộ sticker." },
    uploadAttachment: {
        description: "Upload file/ảnh để gửi qua sendMessage.",
        examples: [
            {
                summary: "Upload ảnh",
                args: ["./path/to/image.jpg", "<threadId>", 0],
            },
        ],
    },

    // ---------- Settings & Utility ----------------------------------------
    keepAlive: {
        description:
            "Giữ session sống. Gọi định kỳ ~5 phút để tránh bị Zalo cut session.",
        examples: [{ summary: "Keep alive", args: [] }],
    },
    updateSettings: { description: "Cập nhật setting tài khoản (privacy, ...)." },
    updateLang: { description: "Đổi ngôn ngữ tài khoản (vi/en)." },
    getLabels: { description: "Danh sách label đã tạo." },
    updateLabels: { description: "Sửa label." },
    getAutoDeleteChat: { description: "Lấy setting auto-delete chat." },
    updateAutoDeleteChat: { description: "Đổi auto-delete chat (thời gian)." },
    getCookie: {
        description:
            "Trả về tough-cookie CookieJar đang dùng. Dùng để debug hoặc export thủ công.",
    },
    getContext: {
        description:
            "Trả về context session: uid, imei, secretKey, userAgent, ...",
    },
    custom: {
        description: "Gọi raw Zalo API (advanced — đọc source zca-js để biết cách dùng).",
    },
    undo: { description: "Thu hồi 1 hành động (chỉ áp dụng vài action)." },
    parseLink: {
        description: "Lấy preview meta của 1 link (title, description, image).",
        examples: [{ summary: "Parse URL", args: ["https://example.com"] }],
    },
    getQR: { description: "Tạo QR code cho thông tin nào đó (xem zca-js docs)." },
    getBizAccount: { description: "Thông tin tài khoản business (zBusiness)." },
    getRelatedFriendGroup: { description: "Group có chung bạn bè." },
};

export interface MethodFullDoc {
    name: string;
    category: string;
    description: string;
    notes?: string;
    /** TypeScript params signature, e.g. "(threadId: string, type?: ThreadType)" */
    params: string;
    /** TypeScript return type, e.g. "Promise<SendMessageResponse>" */
    returnType: string;
    /** Practical examples — args arrays usable directly with /api/{id}/{method} */
    examples: Array<{ summary: string; args: unknown[] }>;
    /** Doc URL on zca-js.tdung.com (kept for reference, not required) */
    docUrl: string;
}

export function getMethodDocs(name: string): MethodFullDoc | null {
    const cat = METHOD_CATALOG.find((m) => m.name === name);
    const sigs = loadSignatures();
    const sig = sigs[name];
    const doc = DOCS[name];
    if (!cat && !sig) return null;
    return {
        name,
        category: cat?.category ?? "Other",
        description:
            doc?.description ??
            "Chưa có mô tả tiếng Việt. Tham số xem ở signature bên dưới.",
        notes: doc?.notes,
        params: sig?.params ?? "(...args)",
        returnType: sig?.returnType ?? "Promise<unknown>",
        examples: doc?.examples ?? [{ summary: "Default", args: [] }],
        docUrl: cat?.docUrl ?? `https://zca-js.tdung.com/vi/apis/${name}.html`,
    };
}

export function getAllMethodDocs(): MethodFullDoc[] {
    const sigs = loadSignatures();
    const seen = new Set<string>();
    const out: MethodFullDoc[] = [];

    // Catalog-known methods first (preserves category order)
    for (const cat of METHOD_CATALOG) {
        const full = getMethodDocs(cat.name);
        if (full) {
            out.push(full);
            seen.add(cat.name);
        }
    }
    // Methods that exist in zca-js but aren't in our catalog → "Other"
    for (const name of Object.keys(sigs)) {
        if (seen.has(name)) continue;
        const sig = sigs[name]!;
        out.push({
            name,
            category: "Other",
            description: "Method tồn tại trong zca-js nhưng chưa có trong catalog.",
            params: sig.params,
            returnType: sig.returnType,
            examples: [{ summary: "Default", args: [] }],
            docUrl: `https://zca-js.tdung.com/vi/apis/${name}.html`,
        });
    }
    return out;
}

export function groupedFullDocs(): Array<{
    category: string;
    methods: MethodFullDoc[];
}> {
    const all = getAllMethodDocs();
    const map = new Map<string, MethodFullDoc[]>();
    // Preserve catalog ordering by initializing keys in order
    for (const { category } of groupedCatalog()) map.set(category, []);
    for (const m of all) {
        if (!map.has(m.category)) map.set(m.category, []);
        map.get(m.category)!.push(m);
    }
    return [...map.entries()].map(([category, methods]) => ({ category, methods }));
}
