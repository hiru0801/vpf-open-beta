'use strict';

const newsDirectory = [
  ['Liên đoàn Bóng đá Việt Nam (VFF)', [
    ['V.League 1', 'https://www.vff.org.vn/chuyen-muc/giai-quoc-gia/bong-da-nam-cac-giai-quoc-gia/giai-vo-dich-quoc-gia-v-league-1/'],
    ['V.League 2', 'https://www.vff.org.vn/chuyen-muc/giai-quoc-gia/bong-da-nam-cac-giai-quoc-gia/giai-hang-nhat-quoc-gia-v-league-2/'],
    ['Cúp Quốc gia', 'https://www.vff.org.vn/chuyen-muc/giai-quoc-gia/bong-da-nam-cac-giai-quoc-gia/giai-cup-quoc-gia-national-cup/']
  ]],
  ['Bóng Đá Plus', [
    ['V.League 1', 'https://bongdaplus.vn/v-league'],
    ['V.League 2', 'https://bongdaplus.vn/hang-nhat-quoc-gia'],
    ['Cúp Quốc gia', 'https://bongdaplus.vn/cup-quoc-gia']
  ]],
  ['Thanh Niên', [['Bóng đá Việt Nam', 'https://thanhnien.vn/the-thao/bong-da-viet-nam.htm']]],
  ['Znews', [['Bóng đá Việt Nam', 'https://znews.vn/bong-da-viet-nam.html']]],
  ['VTC News', [['Bóng đá Việt Nam', 'https://vtcnews.vn/bong-da-viet-nam-115.html']]],
  ['VnExpress', [['V.League', 'https://vnexpress.net/the-thao/v-league']]]
];

function newsView() {
  const entries = newsDirectory.map(([name, sections]) => {
    const links = sections.map(([title, url]) => '<li><a href="'+safeUrl(url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+
      escapeHtml(name+' · '+title+' (mở tab mới)')+'">'+escapeHtml(title)+'</a></li>').join('');
    return '<section class="panel padded news-directory-source"><h2>'+escapeHtml(name)+'</h2><ul class="links-list">'+links+'</ul></section>';
  }).join('');
  return heading('Tin tức', 'Đọc tại chuyên mục của từng nguồn')+
    '<div class="news-directory">'+entries+'</div>';
}
