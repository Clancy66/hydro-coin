import {
    Context, UserModel, DomainModel, Handler, UserNotFoundError, NotFoundError, PRIV, STATUS, 
    ForbiddenError, ObjectId, db, FileExistsError, ValidationError, StorageModel
} from 'hydrooj';
import { CoinsModel, BillsModel, GoodsModel, BagModel } from './model';
import path from 'path';
import { HeatmapModel } from './virtual_goods';

// 商品列表
class ShopHandler extends Handler {
    async get() {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError("你没有权限");
        }

        // 获取商品列表
        const gdocs = (await GoodsModel.getMany());
        const ucoins = await CoinsModel.getOne(this.user._id);

        this.response.template = 'shop.html';
        this.response.body = { ...this.response.body, gdocs, ucoins };
    }

    async post() {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError("你没有权限");
        }
    }

    async postPurchaseGoods(args: any) {
        const { goodsId } = args;

        try {
            // 1. 获取数据
            const goods = await GoodsModel.getOne({ _id: new ObjectId(goodsId) });
            if (!goods) throw new NotFoundError("❗商品不存在");

            const ucoins = await CoinsModel.getOne(this.user._id);

            // 2. 检查购买权限 (保留原有的逻辑判断)
            if (goods.status === false) {
                throw new Error("❗此商品已下架"); // 这里用普通 Error 即可，因为我们要自己处理
            }

            if (ucoins.total < goods.price) {
                throw new Error("❗你的金币不足");
            }

            const hasPurchase = await BillsModel.getMany({ uid: this.user._id, goodsId: goodsId });
            if (goods.limit !== 0 && hasPurchase.length >= goods.limit) {
                throw new Error("❗你已经达到该商品的限购上限");
            }

            // 3. 执行交易
            const currentLog = "[购买商品] " + goods.name;
            let check = 2;  // 虚拟商品无序核销
            if (goods.type === 0) {
                check = 0;  // 实物核销状态为 false
            }
            await BillsModel.add(this.user._id, this.user._id, goodsId, -goods.price, currentLog, check);
            if (goods.amount > 0) {
                await GoodsModel.updateStock(goods._id, -1);
                await GoodsModel.updateSale(goods._id, 1);
            }
            await CoinsModel.inc(this.user._id, { total: -goods.price });
            await BagModel.add(this.user._id, goods._id, goods.type, false);


            // 4. ✅ 成功响应：明确返回 JSON
            this.response.body = {
                success: true,
                message: "🎉 兑换成功！"
            };
            // 注意：如果是 AJAX 请求，通常不建议在这里 redirect，
            // 而是让前端收到 success:true 后自行刷新页面 (location.reload)。
            // 如果必须重定向，前端 fetch 可能会因为跨域或重定向策略报错。
            // 建议注释掉下面这行，改用前端 reload：
            // this.response.redirect = '/shop';

        } catch (err: any) {
            // 5. ✅ 失败响应：捕获所有错误，并返回 JSON
            // 设置 HTTP 状态码为 400 (Bad Request) 或保持 200 但标记 success: false
            this.response.status = 400;
            this.response.body = {
                success: false,
                message: err.message || "未知错误"
            };
        }
    }
}

// 钱包&背包
class CoinManageHandler extends Handler {
    async get() {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('暂无权限');
        }

        const page = parseInt(this.request.query.page || '1');
        const limit = 20;
        const skip = (page - 1) * limit;

        const pipeline = [
            { $sort: { problems: -1, stages: -1 } },

            {
                $lookup: {
                    from: 'user',
                    localField: 'uid',
                    foreignField: '_id',
                    as: 'playerInfo'
                }
            },

            {
                $addFields: {
                    playerInfo: { $arrayElemAt: ['$playerInfo', 0] }
                }
            },

            { $skip: skip },
            { $limit: limit }
        ];

        const udocs = await db.collection('coins').aggregate(pipeline).toArray();
        const total = await db.collection('coins').countDocuments();

        const ucoins = await CoinsModel.getOne(this.user._id);
        const bdocs = await db.collection('bills').aggregate([
            { $match: {uid: this.user._id }},
            { $sort: { createAt: -1 } },
            {
                $lookup: {
                    from: 'user',
                    localField: 'rootId',
                    foreignField: '_id',
                    as: 'playerInfo'
                }
            },
            {
                $project: {
                    createAt: -1, coins: 1, content: 1, check: 1,
                    playerName: { $arrayElemAt: ['$playerInfo.uname', 0] } // 只取用户名
                }
            }
        ]).toArray();

        const bagpipeline = [
            { $match: {uid: this.user._id }},
            {
                $lookup: {
                from: "goods",
                localField: "goodsId",
                foreignField: "_id",
                as: "goodsInfo"
                }
            },
            {
                $addFields: {
                goodsInfo: { $arrayElemAt: ["$goodsInfo", 0] }
                }
            }
        ];

        const bagdocs = await db.collection('bag').aggregate(bagpipeline).toArray();

        this.response.template = 'coin_manage.html';
        this.response.body = { ...this.response.body, ucoins, bdocs, bagdocs, udocs, page, upcount: Math.ceil(total / 20) };
    }

    async post() {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('发布指令遭拒！');
        }
    }
    
    async postLoadedGoods(args: any) {
        const { goodsId } = args;

        const bag = await BagModel.getOne({uid: this.user._id, goodsId: new ObjectId(goodsId)});
        if (!bag) {
            throw new NotFoundError('你的背包中不存在该商品');
        }

        if (bag.type === 0) {
            throw new ForbiddenError('该商品为实物，无需装配');
        }

        if (bag.loaded) {
            throw new FileExistsError('你已经装配该商品');
        }

        const same = await BagModel.getOne({uid: this.user._id, type: bag.type, loaded: true});
        if (same) {
            await BagModel.unload(this.user._id, new ObjectId(same.goodsId));
        }

        await BagModel.load(this.user._id, new ObjectId(goodsId));

        // this.response.redirect = '/coin/manage';
    }

    async postUnloadGoods(args: any) {
        const { goodsId } = args;
        const bag = await BagModel.getOne({uid: this.user._id, goodsId: new ObjectId(goodsId)});
        if (!bag) {
            throw new NotFoundError('你的背包中不存在该商品');
        }

        if (bag.type === 0) {
            throw new ForbiddenError('该商品为实物，无需装配或取消');
        }

        if (bag.loaded === false) {
            throw new NotFoundError('你已经取消装配该商品');
        }

        await BagModel.unload(this.user._id, new ObjectId(goodsId));

        // this.response.redirect = '/coin/manage';
    }
}

// 订单管理
class BillManageHandler extends Handler {
    async get() {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            throw new ForbiddenError('暂无权限');
        }

        const checkdocs = await db.collection('bills').aggregate([
            { $match: {check: 0 }},
            { $sort: { createAt: -1 } },
            {
                $lookup: {
                    from: 'user',
                    localField: 'uid',
                    foreignField: '_id',
                    as: 'playerInfo'
                }
            },
            {
                $project: {
                    createAt: -1, coins: 1, content: 1, check: 1,
                    playerName: { $arrayElemAt: ['$playerInfo.uname', 0] } // 只取用户名
                }
            }
        ]).toArray();

        const checkeddocs = await db.collection('bills').aggregate([
            { $match: {check: 1 }},
            { $sort: { createAt: -1 } },
            {
                $lookup: {
                    from: 'user',
                    localField: 'uid',
                    foreignField: '_id',
                    as: 'playerInfo'
                }
            },
            {
                $project: {
                    createAt: -1, coins: 1, content: 1, check: 1,
                    playerName: { $arrayElemAt: ['$playerInfo.uname', 0] } // 只取用户名
                }
            }
        ]).toArray();

        this.response.template = 'bills_manage.html';
        this.response.body = { ...this.response.body, checkdocs, checkeddocs };
    }

    async post() {
        if (!this.user.hasPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN)) {
            throw new ForbiddenError('发布指令遭拒：您非本域高级管理人员！');
        }
    }

    async postIncCoins(args: any) {
        const { uidOrName, coins, content } = args;

        const user = await UserModel.getById(this.domain._id, Number(uidOrName)).catch(() => null)
                    || await UserModel.getByUname(this.domain._id, uidOrName);

        if (!user) {
            throw new UserNotFoundError('用户 ' + uidOrName + ' 不存在');
        }

        const ucoin = await CoinsModel.getOne(user._id);
        if (ucoin.total + Number(coins) < 0) {
            throw new ForbiddenError('用户 ' + uidOrName + ' 金币不足，请调整扣除金额');
        }

        // 创建账单
        const billid = await BillsModel.add(this.user._id, user._id, "", Number(coins), "[额外扣除] " + content, 2);
        // 更新余额
        await CoinsModel.inc(user._id, {total: Number(coins)});
        // 检查是否为奖励
        if (Number(coins) > 0) {
            await CoinsModel.inc(user._id, {bonus : Number(coins)});
            await BillsModel.updateContent(billid, "[额外奖励] " + content);
        }

        this.response.redirect = '/coin/manage';
    }

    async postCheckBills(args: any) {
        const { billsId } = args;
        const bills = await BillsModel.getOne({_id: new ObjectId(billsId)});
        if (!bills) {
            throw new NotFoundError('订单不存在');
        }

        await BillsModel.check(this.user._id, new ObjectId(billsId));

        this.response.redirect = '/bills/manage';
    }
}

// 商品管理
class ShopManageHandler extends Handler {
    async get() {
        if (!this.user.hasPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN)) {
            throw new ForbiddenError('发布指令遭拒：您非本域高级管理人员！');
        }

        // 修改商品信息，这里返回当前商品信息
        const goodsIdStr = this.request.query.goodsId;
        if (goodsIdStr) {
            const goodsId = new ObjectId(goodsIdStr as string);
            const goods = await GoodsModel.getOne({_id: goodsId});

            if (!goods) throw new NotFoundError('该商品不存在');

            this.response.body = {
                goods
            }
        }

        // 商品列表
        const hiddenDocs = await GoodsModel.getMany({status: false});
        const publicDocs = await GoodsModel.getMany({status: true});
        // 域列表
        const domains = await DomainModel.getMulti().toArray();

        this.response.template = 'goods_manage.html';
        this.response.body = { ...this.response.body, hiddenDocs, publicDocs, domains };
    }

    async post() {
        if (!this.user.hasPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN)) {
            throw new ForbiddenError('发布指令遭拒：您非本域高级管理人员！');
        }
    }

    async postDomainCoins(args: any) {
        const { domainId, price } = args;
        const domain = await GoodsModel.getOne({name: domainId});

        // type = 1
        if (domain) {
            GoodsModel.updateOne(domain._id, domainId, "域内首次 AC 奖励", Number(price), 0, 0, "", 1, true);
        }
        else {
            GoodsModel.add(domainId, "域内首次 AC 奖励", Number(price), 0, 0, "", 1, true);
        }

        this.response.redirect = '/goods/manage';
    }

    async postAddGoods(args: any) {
        const { goodsId, name, description, price, amount, limit, type, status } = args;

        const file = this.request.files?.image;

        let imageUrl = null;
        if (file.size > 0) {
            if (file.size > 8 * 1024 * 1024) throw new ValidationError('file');
            const ext = path.extname(file.originalFilename).toLowerCase();
            if (!['.jpg', '.jpeg', '.png'].includes(ext)) throw new ValidationError('file');
            await StorageModel.put(`user/${this.user._id}/${file.originalFilename}`, file.filepath, this.user._id);
            imageUrl = '/file/' + this.user._id + '/' + file.originalFilename;    
        }

        const goods = await GoodsModel.getOne({_id: new ObjectId(goodsId)});
        if (goodsId !== "" && goodsId !== undefined) {
            if (imageUrl === null) {
                imageUrl = goods.imageUrl;
            }
            await GoodsModel.updateOne(
                goods._id,
                name,
                description,
                Number(price),
                Number(amount),
                Number(limit),
                imageUrl,
                Number(type),
                Boolean(status)
            );
        }
        else {
            await GoodsModel.add(
                name,
                description,
                Number(price),
                Number(amount),
                Number(limit),
                imageUrl,
                Number(type),
                Boolean(status)
            );
        }

        this.response.redirect = '/goods/manage';
    }

    async postDisableGoods(args: any) {
        const { goodsId } = args;
        const goods = await GoodsModel.getOne({_id: new ObjectId(goodsId)});
        if (!goods) {
            throw new FileExistsError('商品不存在');
        }

        GoodsModel.hidden(goods._id);

        this.response.redirect = '/goods/manage';
    }

    async postPublicGoods(args: any) {
        const { goodsId } = args;
        const goods = await GoodsModel.getOne({_id: new ObjectId(goodsId)});
        if (!goods) {
            throw new FileExistsError('商品不存在');
        }

        GoodsModel.public(goods._id);

        this.response.redirect = '/goods/manage';
    }

    async postDeleteGoods(args: any) {
        const { goodsId } = args;
        const goods = await GoodsModel.getOne({_id: new ObjectId(goodsId)});
        if (!goods) {
            throw new FileExistsError('商品不存在');
        }

        GoodsModel.delete(goods._id);

        this.response.redirect = `/goods/manage`;
    }
}

// 3:头像框
class AvatarFrameHandler extends Handler {
    async get() {
        const uid = this.request.query.uid;
        const hasAvatarFrame = await BagModel.getOne({uid: Number(uid), type: 3, loaded: true});
        
        if (hasAvatarFrame) {
            const userAvatarFrame = await GoodsModel.getOne({_id: hasAvatarFrame.goodsId});
            this.response.body = {
                success: true,
                userAvatarFrame
            };
        }
        else {
            this.response.body = {
                success: false
            }; 
        }
    }
}

// 4:头像
class AvatarHandler extends Handler {
    async get() {
        const uid = this.request.query.uid;
        const hasAvatar = await BagModel.getOne({uid: Number(uid), type: 4, loaded: true});
        
        if (hasAvatar) {
            const userAvatar = await GoodsModel.getOne({_id: hasAvatar.goodsId});
            this.response.body = {
                success: true,
                userAvatar
            };
        }
        else {
            this.response.body = {
                success: false
            }; 
        }
    }
}

// 5:背景
class BackgroundHandler extends Handler {
    async get() {
        const uid = this.request.query.uid;
        const hasBackground = await BagModel.getOne({uid: Number(uid), type: 5, loaded: true});
        
        if (hasBackground) {
            const userBackground = await GoodsModel.getOne({_id: hasBackground.goodsId});
            this.response.body = {
                success: true,
                userBackground
            };
        }
        else {
            this.response.body = {
                success: false
            }; 
        }
    }
}

// 配置项及路由
export async function apply(ctx: Context) {
    // type: 0:实物, 1:域内首次 AC, 2:热力图
    // 添加虚拟商品，仅首次安装时运行
    const virtual_goods = await db.collection('system').findOne({ _id: 'virtual_goods' });
    if (!virtual_goods) {
        // 热力图
        await db.collection('goods').findOneAndUpdate(
            { type: 2 },
            { $set: {
                name: '热力图',
                description: '在个人主页展示提交热力图', 
                price: 99, 
                amount: 0,
                limit: 1, 
                imageUrl: "/heatmap.png", 
                type: 2,
                status: true,
                sale: 0
            }},
            { upsert: true }
        );

        const currentLog = '[virtual_goods] 虚拟商品添加完成！';
        await db.collection('system').insertOne({ _id: 'virtual_goods', value: currentLog });
        console.log(currentLog);
    }

    // 个人主页挂载热力图
    ctx.on('handler/after/UserDetail#get', async (handler) => {
        const userHeatmap = await BagModel.getOne({uid: Number(handler.args.uid), type: 2, loaded: true});
        if (!userHeatmap) return ;
        handler.response.body.heatmap = await HeatmapModel.getHeatmap(handler.user._id);
    });

    ctx.on('record/judge', async (rdoc, updated, pdoc, t) => {
        try {
            // 1. 只处理 AC
            if (rdoc.status !== STATUS.STATUS_ACCEPTED) return;

            // 2. 排除比赛
            if (rdoc.contest) return;
            if (!updated) return;

            // 3. 查奖励配置
            const ddoc = await GoodsModel.getOne({ name: rdoc.domainId });
            if (!ddoc || ddoc.status === false) return;

            // 4. 防重复（核心）
            const bdoc = await BillsModel.getOne({
                uid: rdoc.uid,
                goodsId: String(rdoc.pid)
            });

            if (bdoc) return;

            // 5. 写账单
            await BillsModel.add(
                1,
                rdoc.uid,
                String(rdoc.pid),
                ddoc.price,
                '[刷题奖励] 首次 AC ' + pdoc.pid,
                2
            );

            await CoinsModel.inc(rdoc.uid, {
                total: Number(ddoc.price),
                problems: Number(ddoc.price)
            });
        } catch (e) {
            console.error('[first AC reward error]', e);
        }
    });

    ctx.Route('shop', '/shop', ShopHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('goods_manage', '/goods/manage', ShopManageHandler, PRIV.PRIV_MANAGE_ALL_DOMAIN);
    ctx.Route('coin_manage', '/coin/manage', CoinManageHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('bills_manage', '/bills/manage', BillManageHandler, PRIV.PRIV_MANAGE_ALL_DOMAIN);
    // 全局挂载头像框、头像、背景
    ctx.Route('avatar_frame', '/avatar/frame', AvatarFrameHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('my_avatar', '/avatar', AvatarHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('my_background', '/background', BackgroundHandler, PRIV.PRIV_USER_PROFILE);

    
    ctx.injectUI('UserDropdown', 'coin_manage', { icon: 'bold', displayName: '钱包&背包' }, PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('UserDropdown', 'shop', { icon: 'search', displayName: '神秘商店' }, PRIV.PRIV_USER_PROFILE);
    ctx.injectUI('UserDropdown', 'bills_manage', { icon: 'edit', displayName: '奖励&核销' }, PRIV.PRIV_MANAGE_ALL_DOMAIN);

    ctx.injectUI('Nav', 'shop', {}, PRIV.PRIV_USER_PROFILE);
    ctx.i18n.load('zh', {
        shop: '神秘商店',
    })
}
