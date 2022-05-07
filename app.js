// requiring main paert
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const ejs = require('ejs');
const ejsMate = require('ejs-mate');
const Campground = require('./models/campground');
const User = require('./models/user');
const Review = require('./models/review');
const session = require('express-session');
const flash = require("connect-flash");
const passport = require("passport");
const passportLocal = require("passport-local");
const passportLocalMongoose = require('passport-local-mongoose');
const methodOverride = require('method-override');
const path = require('path');
const { isLoggedIn, existingCamp, isOwner, isReviewOwner, existingReview } = require('./middleware');
const {catchAsync, ExpressError} = require('./utils')
const zips = require('./seeds/zips');
const sass = require('sass');
const campground = require('./models/campground');

// connecting mongoose
mongoose.connect("mongodb://0.0.0.0:27017/CampProject");
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error"));
db.once("open", () => {
  console.log("Database connected");
});

// making session

const sessionConfig = {
    secret: "itTime",
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7
    }
};

app.use(session(sessionConfig));

//using passport for user registration and auth

app.use(passport.initialize());
app.use(passport.session());
passport.use(new passportLocal(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

//using locals for flash and userSession
app.use(flash());
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.returnTo = req.originalUrl;
    next();
})

//making setups
app.engine('ejs', ejsMate);
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')))
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

//user routes

app.route('/login')
.get((req, res) => {
    res.render('users/login')
})
.post(passport.authenticate('local', {failureFlash:true, failureRedirect: '/login'}), 
    async (req, res) => {
        req.flash('success', `Welcome back, ${req.user.name}`);
        if (!req.session.returnTo) {res.redirect('/campgrounds')} else {
            res.redirect(req.session.returnTo)}
            delete req.session.returnTo;
})

app.route('/register')
.get((req, res) => {
    res.render('users/register')
})
.post(catchAsync (async (req, res) => {
    const {username, password, email, name} = req.body;
    const user = new User({email, username, name});
    const registeredUser = await User.register(user, password);
    req.login(registeredUser, err => {
        if (err) return next();
        req.flash('success', 'Welcome to Camp');
        res.redirect('/home')
    })
}))

app.get('/home', (req, res) => {
    req.session.returnTo = req.originalUrl;
    res.render('home')
})

app.post('/logout', async (req, res) => {
    req.logout();
    req.flash('success', 'You was successfully logged out');
    res.redirect('/campgrounds');
})

app.get('/campgrounds/new', isLoggedIn, (req, res) => {
    res.render('campgrounds/new', {zips})
})


app.get('/campgrounds', catchAsync (async (req, res) => {
    const campgrounds = await Campground.find();
    res.render("campgrounds/index", { campgrounds })
}))

app.post('/campgrounds', catchAsync( async (req, res) => {
    const campground = new Campground(req.body.campground)
    campground.location = req.body.location;
    campground.contacts = req.body.contacts;
    campground.owner = req.user._id;
    campground.image = req.body.campground.image;
    await campground.save(function(err) {
      if (err) console.log(err)});
    req.flash('success', 'Your campground was added to system!')
    res.redirect(`/campgrounds/${campground.id}`)
}))


app.route('/campgrounds/:id')
.get(existingCamp, catchAsync (async (req, res) => {
    req.session.returnTo = req.originalUrl;
    const campground = await Campground.findById(req.params.id);
    res.render('campgrounds/show', {campground})
}))
.delete(existingCamp, isLoggedIn, isOwner, catchAsync (async (req, res) => {
    const { id } = req.params;
    await Campground.findByIdAndRemove(id);
    req.flash('success', 'Your campground was deleted!')
    res.redirect("/campgrounds");
}))
.patch(
    existingCamp, 
    isLoggedIn, 
    isOwner, 
    catchAsync( async (req, res) => {
        const { id } = req.params;
        const campground = req.body.campground;
        campground.location = req.body.location;
        campground.contacts = req.body.contacts;
        campground.image = req.body.campground.image;
        const campgroundUpd = await Campground.findByIdAndUpdate(id, campground);
        req.flash('success', 'Your campground was updated!');
        res.redirect(`/campgrounds/${campgroundUpd.id}`);
}))

app.route('/campgrounds/:id/edit')
.get(existingCamp, isLoggedIn, isOwner, catchAsync(async (req, res) => {
    const campground = await Campground.findById(req.params.id);
    res.render("campgrounds/edit", { campground, zips });
}))

app.post('/campgrounds/:id/reviews',
    isLoggedIn, 
    catchAsync( async (req, res) => {
    const campground = await await Campground.findById(req.params.id).populate({path: "reviews", populate: {path: 'owner'}}).populate('owner')
    const review = new Review(req.body.review);
    review.owner = req.user._id;
    campground.reviews.push(review);
    await review.save();
    await campground.save(function(err) {
        if (err) console.log(err)});
    req.flash('success', 'Your review added')
    res.redirect(`/campgrounds/${campground.id}`);
}))

app.route('/campgrounds/:id/reviews/:reviewId')
.delete(existingReview, isLoggedIn, isReviewOwner, catchAsync(async (req, res) => {
    const { id, reviewId } = req.params;
    await Campground.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    Review.findByIdAndRemove(reviewId);
    req.flash('success', 'Your review was deleted');
    res.redirect(`/campgrounds/${id}`);
  }))


app.all("*", (req, res, next) => {
    next(new ExpressError("Page Not Found", 404));
});

app.use((err, req, res, next) => {
    const { statusCode = 500 } = err;
    if (!err.message) {
        err.message = "Oh No, Something Went Wrong!";
        res.status(statusCode).render("error", { err });
    }
});
// setting port for app
app.listen(3030, console.log("App is working at 3030 port"));