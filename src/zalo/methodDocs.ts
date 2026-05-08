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
interface FieldDoc {
    /** Field name as it appears in the request body. Use dot notation for nested:
     *   "message.msg" → message object's msg property. */
    name: string;
    /** Human-readable type — "string", "number", "object", "0 | 1", "string[]", ... */
    type: string;
    required: boolean;
    description: string;
}

interface MethodDoc {
    description: string;
    notes?: string;
    examples?: Array<{ summary: string; args: unknown[] }>;
    /** Per-field descriptions for the request body (top-level + nested). */
    fields?: FieldDoc[];
    /** Sample shape of the `data` field in a successful response. */
    sampleResponse?: unknown;
}

const DOCS: Record<string, MethodDoc> = {
    // ---------- Messaging --------------------------------------------------
    sendMessage: {
        description: "Gửi tin nhắn tới 1 user (chat 1-1) hoặc 1 group.",
        fields: [
            { name: "message", type: "object | string", required: true,
              description: "Nội dung tin nhắn. Truyền string để gửi text đơn giản, hoặc object để có rich content." },
            { name: "message.msg", type: "string", required: true,
              description: "Nội dung text (khi message là object)." },
            { name: "message.mentions", type: "Mention[]", required: false,
              description: "Danh sách mention. Mỗi mention { pos, uid, len }. Chỉ dùng khi gửi vào group." },
            { name: "message.urgency", type: "0 | 1 | 2", required: false,
              description: "Mức độ khẩn cấp: 0=Default, 1=Important, 2=Urgent." },
            { name: "threadId", type: "string", required: true,
              description: "userId của người nhận (khi type=0) HOẶC groupId (khi type=1)." },
            { name: "type", type: "0 | 1", required: true,
              description: "0 = gửi cho user (chat 1-1), 1 = gửi vào group." },
        ],
        sampleResponse: { message: { msgId: "5894123456789012345" }, attachment: [] },
        examples: [
            {
                summary: "📩 Gửi cho USER (1-1)",
                args: [{ msg: "Xin chào" }, "<userId>", 0],
            },
            {
                summary: "👥 Gửi vào GROUP",
                args: [{ msg: "Hello cả nhóm" }, "<groupId>", 1],
            },
            {
                summary: "👥 Gửi vào group có @mention",
                args: [
                    { msg: "@An xem nhé", mentions: [{ pos: 0, uid: "<userId>", len: 3 }] },
                    "<groupId>",
                    1,
                ],
            },
            {
                summary: "📩 Gửi text dài cho user (string)",
                args: ["Tin nhắn dài nhiều dòng\nDòng 2", "<userId>", 0],
            },
        ],
    },
    sendSticker: {
        description: "Gửi sticker tới 1 user (1-1) hoặc 1 group.",
        fields: [
            { name: "sticker", type: "object", required: true,
              description: "Object sticker { id, cateId, type }. Lấy từ getStickers." },
            { name: "sticker.id", type: "number", required: true, description: "ID sticker." },
            { name: "sticker.cateId", type: "number", required: true, description: "ID category." },
            { name: "sticker.type", type: "number", required: true, description: "Type sticker." },
            { name: "threadId", type: "string", required: true, description: "userId (type=0) hoặc groupId (type=1)." },
            { name: "type", type: "0 | 1", required: true, description: "0 = user, 1 = group." },
        ],
        sampleResponse: { msgId: "5894123456789012345" },
        examples: [
            { summary: "📩 Gửi sticker cho USER", args: [{ id: 4524, cateId: 109, type: 1 }, "<userId>", 0] },
            { summary: "👥 Gửi sticker vào GROUP", args: [{ id: 4524, cateId: 109, type: 1 }, "<groupId>", 1] },
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
        description: "Thả emoji reaction lên 1 tin nhắn (chat 1-1 hoặc group).",
        fields: [
            { name: "icon", type: "string", required: true,
              description: "Emoji string. Giá trị từ enum Reactions: HAHA, LIKE, HEART, WOW, SAD, ANGRY, ..." },
            { name: "dest", type: "object", required: true, description: "Đích reaction." },
            { name: "dest.threadId", type: "string", required: true, description: "userId (type=0) hoặc groupId (type=1)." },
            { name: "dest.type", type: "0 | 1", required: true, description: "0 = user, 1 = group." },
            { name: "dest.msgId", type: "string", required: true, description: "ID của tin nhắn cần react." },
            { name: "dest.cliMsgId", type: "string", required: true, description: "Client message ID của tin." },
        ],
        sampleResponse: { msgId: "5894..." },
        examples: [
            {
                summary: "📩 React tin USER",
                args: ["HAHA", { threadId: "<userId>", type: 0, msgId: "<msgId>", cliMsgId: "<cliMsgId>" }],
            },
            {
                summary: "👥 React tin GROUP",
                args: ["LIKE", { threadId: "<groupId>", type: 1, msgId: "<msgId>", cliMsgId: "<cliMsgId>" }],
            },
        ],
    },
    sendTypingEvent: {
        description: "Phát event 'đang nhập...' cho thread.",
        examples: [{ summary: "Typing tới user", args: ["<threadId>", 0] }],
    },
    sendSeenEvent: { description: "Đánh dấu tin nhắn là đã xem." },
    sendDeliveredEvent: { description: "Đánh dấu tin nhắn là đã giao." },

    // ---------- Friends ----------------------------------------------------
    getAllFriends: {
        description: "Lấy danh sách bạn bè của tài khoản đang đăng nhập.",
        fields: [
            { name: "count", type: "number", required: false, description: "Số bạn cần lấy. Bỏ trống = tất cả." },
            { name: "page", type: "number", required: false, description: "Trang phân trang (bắt đầu từ 1)." },
            { name: "avatarSize", type: "string", required: false, description: "Kích cỡ avatar URL (small/normal/large)." },
        ],
        sampleResponse: [
            { userId: "1234567890", displayName: "Nguyễn Văn A", phoneNumber: "+84...", avatar: "https://..." },
        ],
        examples: [
            { summary: "Lấy 100 bạn đầu tiên", args: [100, 1] },
            { summary: "Lấy tất cả (mặc định)", args: [] },
        ],
    },
    sendFriendRequest: {
        description: "Gửi lời mời kết bạn kèm message.",
        fields: [
            { name: "message", type: "string", required: true, description: "Lời nhắn kèm yêu cầu kết bạn." },
            { name: "userId", type: "string", required: true, description: "userId của người muốn kết bạn." },
        ],
        sampleResponse: { success: true },
        examples: [{ summary: "Mời kết bạn", args: ["Xin chào, kết bạn nhé!", "<userId>"] }],
    },
    acceptFriendRequest: {
        description: "Chấp nhận lời mời kết bạn từ user.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId người gửi lời mời." }],
        sampleResponse: { success: true },
        examples: [{ summary: "Accept", args: ["<userId>"] }],
    },
    undoFriendRequest: {
        description: "Huỷ lời mời kết bạn đã gửi.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId đã gửi lời mời." }],
    },
    removeFriend: {
        description: "Huỷ kết bạn — xoá user khỏi friend list.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId của bạn cần huỷ." }],
        examples: [{ summary: "Unfriend", args: ["<userId>"] }],
    },
    changeFriendAlias: {
        description: "Đặt biệt danh (alias) cho bạn — chỉ mình bạn thấy.",
        fields: [
            { name: "alias", type: "string", required: true, description: "Tên gợi nhớ." },
            { name: "userId", type: "string", required: true, description: "userId của bạn." },
        ],
        examples: [{ summary: "Đặt alias", args: ["Tên gợi nhớ", "<userId>"] }],
    },
    removeFriendAlias: {
        description: "Xoá alias đã đặt cho bạn.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId của bạn." }],
    },
    blockUser: {
        description: "Chặn user — không nhận tin nhắn / không thấy được nhau.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId muốn chặn." }],
        examples: [{ summary: "Block", args: ["<userId>"] }],
    },
    unblockUser: {
        description: "Bỏ chặn user.",
        fields: [{ name: "userId", type: "string", required: true, description: "userId muốn bỏ chặn." }],
        examples: [{ summary: "Unblock", args: ["<userId>"] }],
    },
    getFriendRequestStatus: { description: "Trạng thái lời mời kết bạn đã gửi." },
    getSentFriendRequest: { description: "Danh sách lời mời kết bạn đã gửi đi." },
    getFriendRecommendations: { description: "Danh sách gợi ý kết bạn." },
    getFriendBoardList: { description: "Danh sách bảng (board) của bạn bè." },

    // ---------- User & Account --------------------------------------------
    fetchAccountInfo: {
        description: "Lấy thông tin tài khoản đang đăng nhập (chính mình).",
        fields: [],
        sampleResponse: {
            profile: {
                userId: "1234567890",
                displayName: "Tấn Tài",
                phoneNumber: "+84...",
                avatar: "https://...",
                gender: 0,
                dob: 988131600,
                sdob: "25/04/2001",
            },
            biz: { desc: "...", cate: 0 },
        },
        examples: [{ summary: "Lấy info", args: [] }],
    },
    getUserInfo: {
        description: "Lấy thông tin chi tiết của user khác theo userId.",
        fields: [
            { name: "userId", type: "string | string[]", required: true,
              description: "1 userId hoặc mảng nhiều userId." },
        ],
        sampleResponse: {
            "1234567890": {
                userId: "1234567890",
                displayName: "Nguyễn Văn A",
                avatar: "https://...",
            },
        },
        examples: [
            { summary: "Một user", args: ["<userId>"] },
            { summary: "Nhiều user", args: [["<uid1>", "<uid2>"]] },
        ],
    },
    getOwnId: {
        description: "Lấy userId của tài khoản đang đăng nhập (mình).",
        fields: [],
        sampleResponse: "1234567890",
        examples: [{ summary: "Get own id", args: [] }],
    },
    findUser: {
        description: "Tìm user theo số điện thoại (chính xác đúng định dạng).",
        fields: [
            { name: "phoneNumber", type: "string", required: true,
              description: "SĐT cần đúng định dạng Zalo nhận (thường là +84... không có dấu)." },
            { name: "avatarSize", type: "string", required: false, description: "Kích cỡ avatar URL." },
        ],
        sampleResponse: {
            uid: "1234567890",
            display_name: "Nguyễn Văn A",
            zalo_name: "...",
            avatar: "https://...",
            cover: "https://...",
            gender: 0,
            globalId: "...",
        },
        examples: [{ summary: "Tìm theo SĐT (đúng format Zalo)", args: ["+84..."] }],
    },
    findByPhone: {
        description:
            "Tìm user theo SĐT — TỰ ĐỘNG thử các định dạng (+84..., 0..., 84...). " +
            "Khuyến nghị dùng thay cho findUser vì không cần lo định dạng SĐT.",
        fields: [
            { name: "phoneNumber", type: "string", required: true,
              description: "SĐT — bất kỳ định dạng phổ biến nào: +84xxx, 0xxx, 84xxx." },
        ],
        sampleResponse: {
            phone: "+84779174220",
            user: {
                uid: "1234567890",
                display_name: "Nguyễn Văn A",
                avatar: "https://...",
            },
        },
        examples: [
            { summary: "Format +84", args: ["+84779174220"] },
            { summary: "Format VN (0...)", args: ["0779174220"] },
        ],
    },
    sendByPhone: {
        description:
            "Gửi tin 1-1 cho user theo SĐT. Server tự tìm user (auto-format SĐT) " +
            "rồi gọi sendMessage. Tiện khi không biết userId.",
        fields: [
            { name: "phoneNumber", type: "string", required: true,
              description: "SĐT người nhận — bất kỳ định dạng: +84xxx, 0xxx, 84xxx." },
            { name: "message", type: "string | object", required: true,
              description: "Nội dung tin. String đơn giản hoặc object MessageContent {msg, mentions, ...}." },
        ],
        sampleResponse: {
            phone: "+84779174220",
            user: { uid: "1234567890", display_name: "Nguyễn Văn A" },
            sendResult: { message: { msgId: "5894..." }, attachment: [] },
        },
        examples: [
            { summary: "Tin text đơn giản", args: ["+84779174220", "Xin chào"] },
            { summary: "Format VN (0...)", args: ["0779174220", "Tin từ script"] },
            { summary: "Tin rich content", args: ["+84779174220", { msg: "Xem này", urgency: 1 }] },
        ],
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
        description: "Tạo group chat mới với danh sách thành viên ban đầu.",
        fields: [
            { name: "name", type: "string", required: false, description: "Tên nhóm." },
            { name: "members", type: "string[]", required: true,
              description: "Mảng userId của các thành viên thêm vào nhóm." },
            { name: "avatarSource", type: "AttachmentSource", required: false,
              description: "Đường dẫn file ảnh hoặc Attachment object dùng làm avatar." },
        ],
        sampleResponse: {
            groupId: "1234567890",
            groupType: 1,
            sucessMembers: ["<uid1>", "<uid2>"],
            errorMembers: [],
        },
        examples: [
            { summary: "Tạo group", args: [{ name: "Tên nhóm", members: ["<uid1>", "<uid2>"] }] },
        ],
    },
    getAllGroups: {
        description: "Lấy danh sách groupId mà tài khoản đang tham gia.",
        fields: [],
        sampleResponse: { gridVerMap: { "<groupId1>": 0, "<groupId2>": 0 } },
        examples: [{ summary: "List groups", args: [] }],
    },
    getGroupInfo: {
        description: "Lấy chi tiết của 1 group hoặc nhiều group.",
        fields: [
            { name: "groupId", type: "string | string[]", required: true,
              description: "1 groupId hoặc mảng groupId." },
        ],
        sampleResponse: {
            gridInfoMap: {
                "<groupId>": {
                    groupId: "<groupId>",
                    name: "Tên nhóm",
                    desc: "Mô tả",
                    avt: "https://...",
                    memberIds: ["<uid1>", "<uid2>"],
                    creatorId: "<uid>",
                },
            },
        },
        examples: [{ summary: "Lấy 1 group", args: ["<groupId>"] }],
    },
    getGroupMembersInfo: {
        description: "Lấy thông tin chi tiết các thành viên trong group.",
        fields: [
            { name: "memberIds", type: "string[]", required: true, description: "Mảng userId cần lấy info." },
            { name: "groupId", type: "string", required: true, description: "groupId chứa các member." },
        ],
        examples: [{ summary: "Lấy theo uid", args: [["<uid1>", "<uid2>"], "<groupId>"] }],
    },
    addUserToGroup: {
        description: "Thêm user(s) vào group hiện tại.",
        fields: [
            { name: "memberIds", type: "string | string[]", required: true,
              description: "1 userId hoặc mảng userIds muốn thêm vào group." },
            { name: "groupId", type: "string", required: true, description: "groupId đích." },
        ],
        sampleResponse: { errorMembers: [], succMembers: ["<uid>"] },
        examples: [
            { summary: "Thêm 1 người", args: ["<userId>", "<groupId>"] },
            { summary: "Thêm nhiều người", args: [["<uid1>", "<uid2>"], "<groupId>"] },
        ],
    },
    removeUserFromGroup: {
        description: "Xoá user(s) khỏi group. Cần quyền admin hoặc owner của nhóm.",
        fields: [
            { name: "memberIds", type: "string | string[]", required: true, description: "userId hoặc mảng cần xoá." },
            { name: "groupId", type: "string", required: true, description: "groupId của nhóm." },
        ],
        sampleResponse: { errorMembers: [], succMembers: ["<uid>"] },
        examples: [{ summary: "Đuổi 1 user", args: ["<userId>", "<groupId>"] }],
    },
    inviteUserToGroups: { description: "Mời 1 user vào nhiều group cùng lúc." },
    addGroupDeputy: { description: "Phong phó nhóm." },
    removeGroupDeputy: { description: "Gỡ phó nhóm." },
    changeGroupName: {
        description: "Đổi tên group.",
        fields: [
            { name: "name", type: "string", required: true, description: "Tên mới của group." },
            { name: "groupId", type: "string", required: true, description: "groupId cần đổi tên." },
        ],
        sampleResponse: { success: true },
        examples: [{ summary: "Đổi tên", args: ["Tên mới", "<groupId>"] }],
    },
    changeGroupAvatar: { description: "Đổi avatar nhóm." },
    changeGroupOwner: { description: "Chuyển quyền chủ nhóm sang user khác." },
    disperseGroup: { description: "Giải tán nhóm (chỉ owner)." },
    leaveGroup: {
        description: "Rời nhóm. Sau khi rời sẽ không nhận được tin nữa.",
        fields: [{ name: "groupId", type: "string", required: true, description: "groupId muốn rời." }],
        sampleResponse: { success: true },
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
        fields: [
            { name: "link", type: "string", required: true, description: "URL mời nhóm dạng https://zalo.me/g/..." },
        ],
        sampleResponse: { groupId: "1234567890", success: true },
        examples: [{ summary: "Join via link", args: ["https://zalo.me/g/..."] }],
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
        description: "Tắt thông báo (mute) cho 1 cuộc trò chuyện 1-1 hoặc group.",
        fields: [
            { name: "threadId", type: "string", required: true, description: "userId (type=0) hoặc groupId (type=1)." },
            { name: "type", type: "0 | 1", required: true, description: "0 = user, 1 = group." },
            { name: "duration", type: "number", required: true,
              description: "Thời gian mute tính bằng giây. -1 = mute vĩnh viễn." },
        ],
        sampleResponse: { success: true },
        examples: [
            { summary: "📩 Mute USER 1 giờ", args: [{ threadId: "<userId>", type: 0, duration: 3600 }] },
            { summary: "👥 Mute GROUP vĩnh viễn", args: [{ threadId: "<groupId>", type: 1, duration: -1 }] },
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
        description: "Giữ session sống. Server đã tự gọi mỗi 4 phút — bạn ít khi cần gọi tay.",
        fields: [],
        sampleResponse: { success: true },
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
        description: "Lấy preview meta (title, description, image) của 1 URL — dùng trước khi sendLink.",
        fields: [{ name: "link", type: "string", required: true, description: "URL cần parse." }],
        sampleResponse: { title: "...", desc: "...", thumb: "https://...", url: "https://example.com" },
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
    /** Just the param names parsed out of `params`, in order. */
    paramNames: string[];
    /** TypeScript return type, e.g. "Promise<SendMessageResponse>" */
    returnType: string;
    /** Practical examples — args arrays usable directly with /api/{id}/{method} */
    examples: Array<{ summary: string; args: unknown[] }>;
    /** Per-field Vietnamese descriptions (top-level + dotted nested keys). */
    fields: FieldDoc[];
    /** Sample shape of `data` in successful response — null if not documented. */
    sampleResponse: unknown;
    /** Doc URL on zca-js.tdung.com (kept for reference, not required) */
    docUrl: string;
}

function parseParamNames(paramsStr: string): string[] {
    const inner = paramsStr.replace(/^\(|\)$/g, "").trim();
    if (!inner) return [];
    const parts: string[] = [];
    let depth = 0;
    let buf = "";
    for (const ch of inner) {
        if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
            parts.push(buf.trim());
            buf = "";
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.map((p) => {
        const m = /^([\w$]+)(\?)?\s*:/.exec(p);
        return m && m[1] ? m[1] : p.trim();
    });
}

/** Virtual-method signatures — methods we expose ourselves (not from zca-js). */
const VIRTUAL_PARAMS: Record<string, string> = {
    findByPhone: "(phoneNumber: string)",
    sendByPhone: "(phoneNumber: string, message: string | MessageContent)",
};

export function getMethodDocs(name: string): MethodFullDoc | null {
    const cat = METHOD_CATALOG.find((m) => m.name === name);
    const sigs = loadSignatures();
    const sig = sigs[name];
    const doc = DOCS[name];
    if (!cat && !sig) return null;
    const params = VIRTUAL_PARAMS[name] ?? sig?.params ?? "(...args)";
    const paramNames = parseParamNames(params);
    return {
        name,
        category: cat?.category ?? "Other",
        description:
            doc?.description ??
            "Chưa có mô tả tiếng Việt. Tham số xem ở signature bên dưới.",
        notes: doc?.notes,
        params,
        paramNames,
        returnType: sig?.returnType ?? "Promise<unknown>",
        examples: doc?.examples ?? [{ summary: "Default", args: [] }],
        fields: doc?.fields ?? fallbackFields(paramNames),
        sampleResponse: doc?.sampleResponse ?? null,
        docUrl: cat?.docUrl ?? `https://zca-js.tdung.com/vi/apis/${name}.html`,
    };
}

/** When a method has no hand-written `fields`, generate placeholder entries
 *  from the parsed param names. Type/required/description are unknown. */
function fallbackFields(paramNames: string[]): FieldDoc[] {
    return paramNames.map((name) => ({
        name,
        type: "unknown",
        required: false,
        description: "(Chưa có mô tả tiếng Việt — xem signature TypeScript)",
    }));
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
        const paramNames = parseParamNames(sig.params);
        out.push({
            name,
            category: "Other",
            description: "Method tồn tại nhưng chưa có trong catalog.",
            params: sig.params,
            paramNames,
            returnType: sig.returnType,
            examples: [{ summary: "Default", args: [] }],
            fields: fallbackFields(paramNames),
            sampleResponse: null,
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
