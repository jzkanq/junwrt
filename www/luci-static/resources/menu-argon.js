'use strict';
'require baseclass';
'require ui';

const modemSections = [
    [_('Connection'), ['speedtest', 'guard', 'usage', 'signal']],
    [_('Phone & alerts'), ['phone', 'notify', 'bot']],
    [_('Router settings'), ['junwrt-settings', 'lights', 'autorestart', 'security', 'parental-control', 'wifischedule']],
    [_('Maintenance'), ['update', 'support']]
];

function renderModemSections(menu, children, url) {
    const path = L.env.dispatchpath;
    const active = path[1] === 'modem' ? path[2] : null;
    const pages = new Map(children.map(child => [child.name, child]));
    const renderLink = child => {
        const current = child.name === active;
        return E('li', {}, E('a', {
            href: L.url(url, child.name),
            class: current ? 'food active' : 'food',
            'aria-current': current ? 'page' : null,
            'data-title': child.title.replace(/ /g, '_')
        }, [_(child.title)]));
    };

    menu.classList.add('junwrt-modem-menu');
    if (active)
        menu.classList.add('active');
    if (!document.getElementById('junwrt-modem-menu-css'))
        document.head.appendChild(E('link', {
            id: 'junwrt-modem-menu-css',
            rel: 'stylesheet',
            href: L.resource('junwrt-modem-menu.css')
        }));

    if (pages.has('3ginfo-lite')) {
        menu.appendChild(renderLink(pages.get('3ginfo-lite')));
        pages.delete('3ginfo-lite');
    }
    for (const [title, names] of modemSections) {
        const links = names.filter(name => pages.has(name)).map(name => {
            const link = renderLink(pages.get(name));
            pages.delete(name);
            return link;
        });
        if (!links.length)
            continue;
        const current = names.includes(active);
        menu.appendChild(E('li', { class: 'junwrt-modem-group' }, E('details', {
            name: 'junwrt-modem-navigation',
            open: current ? '' : null
        }, [
            E('summary', { class: current ? 'junwrt-modem-current' : null }, [title]),
            E('ul', {}, links)
        ])));
    }
    // Keep third-party and future Modem pages reachable without a hard-coded group.
    for (const page of pages.values())
        menu.appendChild(renderLink(page));
    return menu;
}

const SlideAnimations={durations:{fast:200,normal:400,slow:600},runningAnimations:new WeakMap(),slideDown:function(element,duration,callback){if(!element){console.warn('SlideAnimations.slideDown: No element provided');return;}
this.stop(element);const animDuration=typeof duration==='string'?this.durations[duration]||this.durations.normal:(duration||this.durations.normal);const originalStyles={display:element.style.display,overflow:element.style.overflow,height:element.style.height,transition:element.style.transition};element.style.display='block';element.style.overflow='hidden';element.style.height='0px';element.style.transition=`height ${animDuration}ms ease-out`;element.offsetHeight;const targetHeight=element.scrollHeight;element.style.height=targetHeight+'px';const cleanup=()=>{element.style.height=originalStyles.height||'';element.style.overflow=originalStyles.overflow||'';element.style.transition=originalStyles.transition||'';this.runningAnimations.delete(element);if(callback&&typeof callback==='function'){try{callback.call(element);}catch(e){console.error('SlideAnimations callback error:',e);}}};const timeoutId=setTimeout(cleanup,animDuration);this.runningAnimations.set(element,{timeoutId,cleanup});},slideUp:function(element,duration,callback){if(!element){console.warn('SlideAnimations.slideUp: No element provided');return;}
this.stop(element);const animDuration=typeof duration==='string'?this.durations[duration]||this.durations.normal:(duration||this.durations.normal);const originalStyles={display:element.style.display,overflow:element.style.overflow,height:element.style.height,transition:element.style.transition};const currentHeight=element.scrollHeight;element.style.overflow='hidden';element.style.height=currentHeight+'px';element.style.transition=`height ${animDuration}ms ease-out`;element.offsetHeight;element.style.height='0px';const cleanup=()=>{element.style.display='none';element.style.height=originalStyles.height||'';element.style.overflow=originalStyles.overflow||'';element.style.transition=originalStyles.transition||'';this.runningAnimations.delete(element);if(callback&&typeof callback==='function'){try{callback.call(element);}catch(e){console.error('SlideAnimations callback error:',e);}}};const timeoutId=setTimeout(cleanup,animDuration);this.runningAnimations.set(element,{timeoutId,cleanup});},stop:function(element){if(!element)return;const animationData=this.runningAnimations.get(element);if(animationData){clearTimeout(animationData.timeoutId);animationData.cleanup();}
element.style.transition='';element.offsetHeight;},isAnimating:function(element){return this.runningAnimations.has(element);}};return baseclass.extend({__init__:function(){document.addEventListener('luci-loaded',L.bind(this.hideLoading,this));ui.menu.load().then(L.bind(this.render,this)).catch(function(err){console.error('Failed to render Argon menu:',err);}).then(L.bind(this.hideLoading,this));},hideLoading:function(){var loading=document.querySelector('.main > .loading');if(loading){loading.style.display='none';loading.setAttribute('aria-hidden','true');}},render:function(tree){var node=tree;var url='';this.renderModeMenu(node);if(L.env.dispatchpath.length>=3){for(var i=0;i<3&&node;i++){node=node.children[L.env.dispatchpath[i]];url=url+(url?'/':'')+L.env.dispatchpath[i];}
if(node){this.renderTabMenu(node,url);}}
this.initThemeToggle();var sidebarToggle=document.querySelector('a.showSide');var darkMask=document.querySelector('.darkMask');if(sidebarToggle){sidebarToggle.addEventListener('click',ui.createHandlerFn(this,'handleSidebarToggle'));}
if(darkMask){darkMask.addEventListener('click',ui.createHandlerFn(this,'handleSidebarToggle'));}},handleMenuExpand:function(ev){var target=ev.target;var slide=target.parentNode;var slideMenu=target.nextElementSibling;var shouldCollapse=false;var activeMenus=document.querySelectorAll('.main .main-left .nav > li > ul.active');activeMenus.forEach(function(ul){SlideAnimations.stop(ul);ul.classList.remove('active');ul.previousElementSibling.classList.remove('active');SlideAnimations.slideUp(ul,'fast');if(!shouldCollapse&&ul===slideMenu){shouldCollapse=true;}});if(!slideMenu){return;}
if(!shouldCollapse){var slideMenuElement=slide.querySelector(".slide-menu");if(slideMenuElement){slideMenu.classList.add('active');target.classList.add('active');SlideAnimations.slideDown(slideMenuElement,'fast');}
target.blur();}
ev.preventDefault();ev.stopPropagation();},renderMainMenu:function(tree,url,level){var currentLevel=(level||0)+1;var menuContainer=E('ul',{'class':level?'slide-menu':'nav'});var children=ui.menu.getChildren(tree);if(children.length===0||currentLevel>2){return E([]);}
if (currentLevel === 2 && url === 'admin/modem')
    return renderModemSections(menuContainer, children, url);
for(var i=0;i<children.length;i++){var child=children[i];var isActive=((L.env.dispatchpath[currentLevel]===child.name)&&(L.env.dispatchpath[currentLevel-1]===tree.name));var submenu=this.renderMainMenu(child,url+'/'+child.name,currentLevel);var hasChildren=submenu.children.length>0;var slideClass=hasChildren?'slide':null;var menuClass=hasChildren?'menu':'food';if(isActive){menuContainer.classList.add('active');slideClass+=" active";menuClass+=" active";}
var menuItem=E('li',{'class':slideClass},[E('a',{'href':L.url(url,child.name),'click':(currentLevel===1)?ui.createHandlerFn(this,'handleMenuExpand'):null,'class':menuClass,'data-title':child.title.replace(/ /g,"_"),},[_(child.title)]),submenu]);menuContainer.appendChild(menuItem);}
if(currentLevel===1){var mainMenuElement=document.querySelector('#mainmenu');if(mainMenuElement){mainMenuElement.appendChild(menuContainer);mainMenuElement.style.display='';}}
return menuContainer;},renderModeMenu:function(tree){var menu=document.querySelector('#modemenu');var children=ui.menu.getChildren(tree);for(var i=0;i<children.length;i++){var isActive=(L.env.requestpath.length?children[i].name==L.env.requestpath[0]:i==0);if(i>0)
menu.appendChild(E([],['\u00a0|\u00a0']));menu.appendChild(E('li',{},[E('a',{'href':L.url(children[i].name),'class':isActive?'active':null},[_(children[i].title)])]));if(isActive)
this.renderMainMenu(children[i],children[i].name);}
if(menu.children.length>1)
menu.style.display='';},renderTabMenu:function(tree,url,level){var container=document.querySelector('#tabmenu');var currentLevel=(level||0)+1;var tabContainer=E('ul',{'class':'tabs'});var children=ui.menu.getChildren(tree);var activeNode=null;if(children.length===0){return E([]);}
for(var i=0;i<children.length;i++){var child=children[i];var isActive=(L.env.dispatchpath[currentLevel+2]===child.name);var activeClass=isActive?' active':'';var className='tabmenu-item-%s %s'.format(child.name,activeClass);var tabItem=E('li',{'class':className},[E('a',{'href':L.url(url,child.name)},[_(child.title)])]);tabContainer.appendChild(tabItem);if(isActive){activeNode=child;}}
if(container){container.appendChild(tabContainer);container.style.display='';if(activeNode){var nestedTabs=this.renderTabMenu(activeNode,url+'/'+activeNode.name,currentLevel);if(nestedTabs.children.length>0){container.appendChild(nestedTabs);}}}
return tabContainer;},handleSidebarToggle:function(ev){var showSideButton=document.querySelector('a.showSide');var sidebar=document.querySelector('#mainmenu');var darkMask=document.querySelector('.darkMask');var scrollbarArea=document.querySelector('.main-right');if(!showSideButton||!sidebar||!darkMask||!scrollbarArea){console.warn('Sidebar toggle elements not found');return;}
if(showSideButton.classList.contains('active')){showSideButton.classList.remove('active');sidebar.classList.remove('active');scrollbarArea.classList.remove('active');darkMask.classList.remove('active');}else{showSideButton.classList.add('active');sidebar.classList.add('active');scrollbarArea.classList.add('active');darkMask.classList.add('active');}},initThemeToggle:function(){var self=this;var btn=document.querySelector('#junwrt-theme-toggle');if(btn&&!btn._junwrtBound){btn._junwrtBound=true;btn.addEventListener('click',function(e){e.preventDefault();self.toggleTheme();});}
self.applyThemeState();window.addEventListener('junwrt-theme-changed',function(){self.applyThemeState();});},toggleTheme:function(){var cur=localStorage.getItem('junwrt_theme')||'auto';var nextTheme='dark';if(cur==='dark'){nextTheme='light';}else if(cur==='light'){nextTheme='dark';}else{var isDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;nextTheme=isDark?'light':'dark';}
try{localStorage.setItem('junwrt_theme',nextTheme);}catch(e){}
this.applyThemeState();window.dispatchEvent(new CustomEvent('junwrt-theme-changed',{detail:{theme:nextTheme}}));},applyThemeState:function(){var savedTheme=localStorage.getItem('junwrt_theme')||'auto';var isDark=false;if(savedTheme==='dark'){isDark=true;}else if(savedTheme==='light'){isDark=false;}else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){isDark=true;}
if(isDark){document.documentElement.setAttribute('data-theme','dark');document.documentElement.classList.add('dark-mode');var dc=document.getElementById('argon-dark-css');if(dc)dc.media='all';}else{document.documentElement.setAttribute('data-theme','light');document.documentElement.classList.remove('dark-mode');var dc2=document.getElementById('argon-dark-css');if(dc2)dc2.media='none';}}});
