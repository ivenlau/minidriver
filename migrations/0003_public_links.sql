-- 图床公开直链：文件级开关，slug 随机不可枚举；NULL = 未公开
ALTER TABLE nodes ADD COLUMN public_slug TEXT;
CREATE UNIQUE INDEX ux_nodes_public_slug ON nodes(public_slug) WHERE public_slug IS NOT NULL;
